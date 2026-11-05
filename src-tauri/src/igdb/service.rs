//! IGDB authentication and request execution.
//!
//! Lock order (never reversed): `admin` → `mint_lock` → `load_lock` → `state`.
//! `state` is a std mutex and is never held across an await.
//!
//! - `admin` serializes credential changes. Set and verify refuse to queue
//!   (`busy`); clear waits for them, so the user's last action wins.
//! - `mint_lock` makes token minting single-flight: concurrent callers that
//!   find no usable token wait for one Twitch request and share its result.
//! - `generation` changes whenever the credentials change, so a token or a
//!   rejection that belongs to replaced or removed credentials is discarded.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::time::Instant;
use zeroize::Zeroize;

use super::http::{HttpExec, HttpRequest, NetError, Target};
use super::limiter::Limiter;
use super::secret::Secret;
use super::store::{CredentialStore, StoreError, StoredCredentials};
use super::validate;

pub struct Config {
    /// IGDB allows 4 per second.
    pub per_second: usize,
    /// IGDB allows 8 open requests; stay well below.
    pub concurrency: usize,
    /// Upper bound for one query including its retries.
    pub request_deadline: Duration,
    /// Upper bound for one Twitch token request.
    pub token_timeout: Duration,
    /// Call the credential store on the async thread instead of the blocking
    /// pool. Tests only, where the store is in memory.
    pub inline_store: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            per_second: 4,
            concurrency: 4,
            request_deadline: Duration::from_secs(30),
            token_timeout: Duration::from_secs(12),
            inline_store: false,
        }
    }
}

pub const RATE_BACKOFF_MS: [u64; 3] = [250, 500, 1000];
pub const SERVER_BACKOFF_MS: [u64; 2] = [500, 1500];
const NETWORK_RETRY_DELAY: Duration = Duration::from_millis(300);
/// A Retry-After longer than this is reported to the caller instead of waited out.
pub const MAX_RETRY_AFTER: Duration = Duration::from_secs(5);
/// Longest shared pause a Retry-After can impose on later requests.
const MAX_SHARED_PAUSE: Duration = Duration::from_secs(60);
const DAY: Duration = Duration::from_secs(86_400);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    MissingCredentials,
    InvalidCredentials,
    InvalidInput,
    RateLimited,
    Network,
    Unavailable,
    BadRequest,
    BadResponse,
    StorageUnsupported,
    StorageUnavailable,
    StorageCorrupted,
    Busy,
    Forbidden,
}

impl ErrorKind {
    fn message(self) -> &'static str {
        match self {
            Self::MissingCredentials => "IGDB credentials are not set",
            Self::InvalidCredentials => "Twitch rejected the IGDB credentials",
            Self::InvalidInput => "The Client ID or Client Secret has an invalid format",
            Self::RateLimited => "IGDB request limit reached",
            Self::Network => "Could not reach Twitch or IGDB",
            Self::Unavailable => "IGDB is temporarily unavailable",
            Self::BadRequest => "IGDB could not process the request",
            Self::BadResponse => "Unexpected response from IGDB",
            Self::StorageUnsupported => "Secure credential storage is not available in this build",
            Self::StorageUnavailable => "The system credential store could not be used",
            Self::StorageCorrupted => "The stored IGDB credentials could not be read",
            Self::Busy => "IGDB credentials are already being verified",
            Self::Forbidden => "This window cannot use IGDB",
        }
    }
}

/// Sent to the frontend. Fixed messages only: never a credential, token, URL,
/// header, response body or underlying error text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IgdbError {
    pub kind: ErrorKind,
    pub status: Option<u16>,
    pub retry_after_ms: Option<u64>,
    pub message: &'static str,
}

impl IgdbError {
    pub fn new(kind: ErrorKind) -> Self {
        Self {
            kind,
            status: None,
            retry_after_ms: None,
            message: kind.message(),
        }
    }

    fn status(kind: ErrorKind, status: u16) -> Self {
        Self {
            status: Some(status),
            ..Self::new(kind)
        }
    }
}

fn store_error(error: StoreError) -> IgdbError {
    IgdbError::new(match error {
        StoreError::Unsupported => ErrorKind::StorageUnsupported,
        StoreError::Unavailable => ErrorKind::StorageUnavailable,
        StoreError::Corrupted => ErrorKind::StorageCorrupted,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageState {
    /// Windows Credential Manager or macOS Keychain.
    Secure,
    /// No secure backend in this build (Linux, Flatpak, mobile).
    Unsupported,
    /// The backend exists but failed (locked, no session, policy).
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialState {
    NotConfigured,
    /// Stored but never accepted by Twitch (not reachable today: saving
    /// requires verification; kept for blobs without a verification time).
    Configured,
    Verified,
    /// Twitch or IGDB rejected the stored credentials this session. They are
    /// kept until the user replaces or removes them.
    Invalid,
    Corrupted,
    Unavailable,
}

/// Everything the frontend may know about IGDB authentication.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IgdbStatus {
    pub storage: StorageState,
    pub state: CredentialState,
    pub verifying: bool,
    /// Last four characters of the Client ID, so the user can tell which app
    /// is configured. The Client ID is a public identifier, not a secret.
    pub client_id_hint: Option<String>,
}

struct Token {
    value: Secret,
    id: u64,
    renew_at: Instant,
}

#[derive(Default)]
struct State {
    loaded: bool,
    load_error: Option<StoreError>,
    credentials: Option<StoredCredentials>,
    rejected: bool,
    token: Option<Token>,
    generation: u64,
}

#[derive(Deserialize)]
struct TokenBody {
    access_token: String,
    expires_in: f64,
}

struct ResetOnDrop<'a>(&'a AtomicBool);

impl Drop for ResetOnDrop<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

pub struct IgdbService {
    store: Arc<dyn CredentialStore>,
    http: Arc<dyn HttpExec>,
    limiter: Limiter,
    config: Config,
    state: Mutex<State>,
    load_lock: tokio::sync::Mutex<()>,
    mint_lock: tokio::sync::Mutex<()>,
    admin: tokio::sync::Mutex<()>,
    verifying: AtomicBool,
    next_token_id: AtomicU64,
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn parse_retry_after(value: Option<&str>) -> Option<Duration> {
    let seconds: f64 = value?.trim().parse().ok()?;
    (0.0..=86_400.0)
        .contains(&seconds)
        .then(|| Duration::from_secs_f64(seconds))
}

fn header_safe(value: &str) -> bool {
    !value.is_empty() && value.len() <= 512 && value.bytes().all(|b| b.is_ascii_alphanumeric())
}

impl IgdbService {
    pub fn new(store: Arc<dyn CredentialStore>, http: Arc<dyn HttpExec>, config: Config) -> Self {
        Self {
            store,
            http,
            limiter: Limiter::new(config.per_second, config.concurrency),
            config,
            state: Mutex::new(State::default()),
            load_lock: tokio::sync::Mutex::new(()),
            mint_lock: tokio::sync::Mutex::new(()),
            admin: tokio::sync::Mutex::new(()),
            verifying: AtomicBool::new(false),
            next_token_id: AtomicU64::new(1),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    async fn store_call<T: Send + 'static>(
        &self,
        f: impl FnOnce(&dyn CredentialStore) -> Result<T, StoreError> + Send + 'static,
    ) -> Result<T, StoreError> {
        if self.config.inline_store {
            return f(self.store.as_ref());
        }
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || f(store.as_ref()))
            .await
            .unwrap_or(Err(StoreError::Unavailable))
    }

    /// Read the store once. An unavailable store is retried on the next call.
    async fn ensure_loaded(&self) {
        if self.lock().loaded {
            return;
        }
        let _load = self.load_lock.lock().await;
        if self.lock().loaded {
            return;
        }
        let result = self.store_call(|store| store.load()).await;
        let mut s = self.lock();
        match result {
            Ok(credentials) => {
                s.loaded = true;
                s.load_error = None;
                s.credentials = credentials;
            }
            Err(error) => {
                s.loaded = error != StoreError::Unavailable;
                s.load_error = Some(error);
                s.credentials = None;
            }
        }
    }

    fn snapshot(&self, s: &State) -> IgdbStatus {
        let verifying = self.verifying.load(Ordering::SeqCst);
        let (storage, state) = match s.load_error {
            Some(StoreError::Unsupported) => {
                (StorageState::Unsupported, CredentialState::Unavailable)
            }
            Some(StoreError::Unavailable) => {
                (StorageState::Unavailable, CredentialState::Unavailable)
            }
            Some(StoreError::Corrupted) => (StorageState::Secure, CredentialState::Corrupted),
            None => match &s.credentials {
                None => (StorageState::Secure, CredentialState::NotConfigured),
                Some(_) if s.rejected => (StorageState::Secure, CredentialState::Invalid),
                Some(c) if s.token.is_some() || c.verified_at.is_some() => {
                    (StorageState::Secure, CredentialState::Verified)
                }
                Some(_) => (StorageState::Secure, CredentialState::Configured),
            },
        };
        let client_id_hint = s.credentials.as_ref().map(|c| {
            let chars: Vec<char> = c.client_id.chars().collect();
            chars[chars.len().saturating_sub(4)..].iter().collect()
        });
        IgdbStatus {
            storage,
            state,
            verifying,
            client_id_hint,
        }
    }

    pub async fn status(&self) -> IgdbStatus {
        if !self.store.supported() {
            return IgdbStatus {
                storage: StorageState::Unsupported,
                state: CredentialState::Unavailable,
                verifying: false,
                client_id_hint: None,
            };
        }
        self.ensure_loaded().await;
        let s = self.lock();
        self.snapshot(&s)
    }

    /// The credentials to authenticate with, or why there are none.
    fn current_credentials(&self) -> Result<(StoredCredentials, u64), IgdbError> {
        let s = self.lock();
        if let Some(error) = s.load_error {
            return Err(store_error(error));
        }
        match &s.credentials {
            None => Err(IgdbError::new(ErrorKind::MissingCredentials)),
            // Don't keep asking Twitch with credentials it already refused.
            Some(_) if s.rejected => Err(IgdbError::new(ErrorKind::InvalidCredentials)),
            Some(c) => Ok((c.clone(), s.generation)),
        }
    }

    fn cached_token(&self) -> Option<(Secret, u64, String)> {
        let s = self.lock();
        let token = s.token.as_ref()?;
        let credentials = s.credentials.as_ref()?;
        (!s.rejected && Instant::now() < token.renew_at)
            .then(|| (token.value.clone(), token.id, credentials.client_id.clone()))
    }

    /// One Twitch client-credentials request. Never touches shared state.
    async fn mint(&self, credentials: &StoredCredentials) -> Result<(Secret, Instant), IgdbError> {
        let form = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("client_id", &credentials.client_id)
            .append_pair("client_secret", credentials.client_secret.expose())
            .append_pair("grant_type", "client_credentials")
            .finish();
        let request = HttpRequest {
            target: Target::TwitchToken,
            client_id: None,
            bearer: None,
            body: Secret::new(form),
        };
        let response =
            match tokio::time::timeout(self.config.token_timeout, self.http.send(request)).await {
                Ok(Ok(response)) => response,
                Ok(Err(NetError::TooLarge)) => return Err(IgdbError::new(ErrorKind::Unavailable)),
                Ok(Err(_)) | Err(_) => return Err(IgdbError::new(ErrorKind::Network)),
            };
        let status = response.status;
        let mut body = response.body;
        let result = match status {
            200..=299 => serde_json::from_slice::<TokenBody>(&body).ok(),
            // Twitch answers 400 for an unknown client and 403 for a wrong secret.
            400 | 401 | 403 => {
                body.zeroize();
                return Err(IgdbError::status(ErrorKind::InvalidCredentials, status));
            }
            429 => {
                body.zeroize();
                return Err(IgdbError::status(ErrorKind::RateLimited, status));
            }
            _ => {
                body.zeroize();
                return Err(IgdbError::status(ErrorKind::Unavailable, status));
            }
        };
        body.zeroize();
        let Some(mut parsed) = result else {
            return Err(IgdbError::new(ErrorKind::Unavailable));
        };
        let token = Secret::new(std::mem::take(&mut parsed.access_token));
        if !header_safe(token.expose()) || parsed.expires_in.is_nan() || parsed.expires_in <= 0.0 {
            return Err(IgdbError::new(ErrorKind::Unavailable));
        }
        let lifetime = Duration::from_secs_f64(parsed.expires_in.min(365.0 * 86_400.0));
        // Renew a day early, or at half-life for short-lived tokens.
        let renew_after = (lifetime / 2).max(lifetime.saturating_sub(DAY));
        Ok((token, Instant::now() + renew_after))
    }

    fn token_id(&self) -> u64 {
        self.next_token_id.fetch_add(1, Ordering::SeqCst)
    }

    /// A usable access token, minting one when needed (single-flight).
    async fn token(&self) -> Result<(Secret, u64, String), IgdbError> {
        if let Some(found) = self.cached_token() {
            return Ok(found);
        }
        let _mint = self.mint_lock.lock().await;
        if let Some(found) = self.cached_token() {
            return Ok(found);
        }
        self.ensure_loaded().await;
        let (credentials, generation) = self.current_credentials()?;
        let result = self.mint(&credentials).await;
        let mut s = self.lock();
        match result {
            Ok((value, renew_at)) => {
                let id = self.token_id();
                if s.generation == generation {
                    s.token = Some(Token {
                        value: value.clone(),
                        id,
                        renew_at,
                    });
                }
                Ok((value, id, credentials.client_id))
            }
            Err(error) => {
                if error.kind == ErrorKind::InvalidCredentials && s.generation == generation {
                    s.rejected = true;
                    s.token = None;
                }
                Err(error)
            }
        }
    }

    /// Drop the cached token if it is still the one that failed.
    fn invalidate(&self, token_id: u64) {
        let mut s = self.lock();
        if s.token.as_ref().is_some_and(|t| t.id == token_id) {
            s.token = None;
        }
    }

    fn reject(&self, token_id: u64) {
        let mut s = self.lock();
        let current = s.token.as_ref().is_none_or(|t| t.id == token_id);
        if current && s.credentials.is_some() {
            s.rejected = true;
            s.token = None;
        }
    }

    /// Run one validated query. Returns IGDB's JSON (public game metadata).
    pub async fn query(&self, endpoint: &str, body: &str) -> Result<serde_json::Value, IgdbError> {
        let endpoint =
            validate::endpoint(endpoint).ok_or_else(|| IgdbError::new(ErrorKind::BadRequest))?;
        validate::body(endpoint, body).map_err(|_| IgdbError::new(ErrorKind::BadRequest))?;
        match tokio::time::timeout(self.config.request_deadline, self.execute(endpoint, body)).await
        {
            Ok(result) => result,
            Err(_) => Err(IgdbError::new(ErrorKind::Network)),
        }
    }

    async fn execute(
        &self,
        endpoint: &'static str,
        body: &str,
    ) -> Result<serde_json::Value, IgdbError> {
        let mut renewed = false;
        let mut rate_retries = 0;
        let mut server_retries = 0;
        let mut network_retries = 0;
        loop {
            let (token, token_id, client_id) = self.token().await?;
            let permit = self.limiter.acquire().await;
            let result = self
                .http
                .send(HttpRequest {
                    target: Target::Igdb(endpoint),
                    client_id: Some(client_id),
                    bearer: Some(token),
                    body: Secret::new(body.to_string()),
                })
                .await;
            drop(permit);
            let response = match result {
                Ok(response) => response,
                Err(NetError::TooLarge) => return Err(IgdbError::new(ErrorKind::BadResponse)),
                Err(_) if network_retries < 1 => {
                    network_retries += 1;
                    tokio::time::sleep(NETWORK_RETRY_DELAY).await;
                    continue;
                }
                Err(_) => return Err(IgdbError::new(ErrorKind::Network)),
            };
            let status = response.status;
            match status {
                200..=299 => {
                    return match serde_json::from_slice::<serde_json::Value>(&response.body) {
                        Ok(
                            value @ (serde_json::Value::Array(_) | serde_json::Value::Object(_)),
                        ) => Ok(value),
                        _ => Err(IgdbError::status(ErrorKind::BadResponse, status)),
                    };
                }
                401 if !renewed => {
                    // Expired or revoked token: renew once and retry.
                    renewed = true;
                    self.invalidate(token_id);
                }
                401 => {
                    self.reject(token_id);
                    return Err(IgdbError::status(ErrorKind::InvalidCredentials, status));
                }
                403 => return Err(IgdbError::status(ErrorKind::InvalidCredentials, status)),
                429 => {
                    let hint = parse_retry_after(response.retry_after.as_deref());
                    if let Some(hint) = hint.filter(|h| *h > MAX_RETRY_AFTER) {
                        self.limiter.pause_for(hint.min(MAX_SHARED_PAUSE));
                        return Err(IgdbError {
                            retry_after_ms: Some(hint.as_millis() as u64),
                            ..IgdbError::status(ErrorKind::RateLimited, status)
                        });
                    }
                    if rate_retries >= RATE_BACKOFF_MS.len() {
                        return Err(IgdbError::status(ErrorKind::RateLimited, status));
                    }
                    let backoff = Duration::from_millis(RATE_BACKOFF_MS[rate_retries]);
                    let wait = hint.map_or(backoff, |h| h.max(backoff));
                    rate_retries += 1;
                    self.limiter.pause_for(wait);
                    tokio::time::sleep(wait).await;
                }
                500..=599 => {
                    if server_retries >= SERVER_BACKOFF_MS.len() {
                        return Err(IgdbError::status(ErrorKind::Unavailable, status));
                    }
                    let wait = Duration::from_millis(SERVER_BACKOFF_MS[server_retries]);
                    server_retries += 1;
                    tokio::time::sleep(wait).await;
                }
                // 400 is a malformed query and 404 an unknown endpoint: our bugs, never retried.
                _ => return Err(IgdbError::status(ErrorKind::BadRequest, status)),
            }
        }
    }

    /// Verify new credentials with Twitch, then store them in one write.
    ///
    /// Nothing is written unless Twitch accepts them, so a typo, a revoked
    /// secret or a network failure leaves the previous credentials (stored
    /// and in memory) exactly as they were.
    pub async fn set_credentials(
        &self,
        client_id: String,
        client_secret: Secret,
    ) -> Result<IgdbStatus, IgdbError> {
        let client_id = client_id.trim().to_string();
        let client_secret = Secret::new(client_secret.expose().trim().to_string());
        if !validate::client_id(&client_id) || !validate::client_secret(client_secret.expose()) {
            return Err(IgdbError::new(ErrorKind::InvalidInput));
        }
        if !self.store.supported() {
            return Err(IgdbError::new(ErrorKind::StorageUnsupported));
        }
        let _admin = self
            .admin
            .try_lock()
            .map_err(|_| IgdbError::new(ErrorKind::Busy))?;
        self.verifying.store(true, Ordering::SeqCst);
        let _reset = ResetOnDrop(&self.verifying);

        let candidate = StoredCredentials {
            client_id,
            client_secret,
            verified_at: Some(unix_now()),
        };
        let (token, renew_at) = self.mint(&candidate).await?;

        let to_save = candidate.clone();
        self.store_call(move |store| store.save(&to_save))
            .await
            .map_err(store_error)?;

        let _mint = self.mint_lock.lock().await;
        let _load = self.load_lock.lock().await;
        let id = self.token_id();
        let mut s = self.lock();
        s.loaded = true;
        s.load_error = None;
        s.credentials = Some(candidate);
        s.rejected = false;
        s.generation += 1;
        s.token = Some(Token {
            value: token,
            id,
            renew_at,
        });
        drop(_reset);
        Ok(self.snapshot(&s))
    }

    /// Ask Twitch for a fresh token with the stored credentials. A rejection
    /// marks them invalid but keeps them; a network failure changes nothing.
    pub async fn verify_credentials(&self) -> Result<IgdbStatus, IgdbError> {
        if !self.store.supported() {
            return Err(IgdbError::new(ErrorKind::StorageUnsupported));
        }
        let _admin = self
            .admin
            .try_lock()
            .map_err(|_| IgdbError::new(ErrorKind::Busy))?;
        self.verifying.store(true, Ordering::SeqCst);
        let _reset = ResetOnDrop(&self.verifying);

        let _mint = self.mint_lock.lock().await;
        self.ensure_loaded().await;
        let (credentials, generation) = {
            let s = self.lock();
            if let Some(error) = s.load_error {
                return Err(store_error(error));
            }
            match &s.credentials {
                None => return Err(IgdbError::new(ErrorKind::MissingCredentials)),
                Some(c) => (c.clone(), s.generation),
            }
        };
        let result = self.mint(&credentials).await;
        let id = self.token_id();
        let mut s = self.lock();
        if s.generation != generation {
            drop(_reset);
            return Ok(self.snapshot(&s));
        }
        match result {
            Ok((value, renew_at)) => {
                s.rejected = false;
                s.token = Some(Token {
                    value,
                    id,
                    renew_at,
                });
            }
            Err(error) if error.kind == ErrorKind::InvalidCredentials => {
                s.rejected = true;
                s.token = None;
            }
            Err(error) => return Err(error),
        }
        drop(_reset);
        Ok(self.snapshot(&s))
    }

    /// Delete the stored credentials and forget the cached token.
    pub async fn clear_credentials(&self) -> Result<IgdbStatus, IgdbError> {
        if !self.store.supported() {
            return Err(IgdbError::new(ErrorKind::StorageUnsupported));
        }
        let _admin = self.admin.lock().await;
        let _mint = self.mint_lock.lock().await;
        let _load = self.load_lock.lock().await;
        let deleted = self.store_call(|store| store.delete()).await;
        let mut s = self.lock();
        // The token goes either way; the credentials only if they're gone from the store.
        s.token = None;
        deleted.map_err(store_error)?;
        s.loaded = true;
        s.load_error = None;
        s.credentials = None;
        s.rejected = false;
        s.generation += 1;
        Ok(self.snapshot(&s))
    }
}
