//! Service tests on a paused clock with an in-memory credential store and a
//! scripted HTTP double. Nothing here touches the OS credential store or the
//! network. Values are dummies, never real credentials.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::future::{join_all, BoxFuture};
use tokio::time::Instant;

use super::http::{HttpExec, HttpRequest, HttpResponse, NetError, Target};
use super::secret::Secret;
use super::service::{Config, CredentialState, ErrorKind, IgdbService, StorageState};
use super::store::memory::MemoryStore;
use super::store::StoredCredentials;

const ID_A: &str = "clientidaaaaaaaaaaaaaaaaaaaaaa";
const SECRET_A: &str = "secretaaaaaaaaaaaaaaaaaaaaaaaa";
const ID_B: &str = "clientidbbbbbbbbbbbbbbbbbbbbbb";
const SECRET_B: &str = "secretbbbbbbbbbbbbbbbbbbbbbbbb";
const GAMES: &str = "fields name; where id = 1942; limit 1;";

#[derive(Clone, Debug)]
struct Seen {
    target: Target,
    client_id: Option<String>,
    bearer: Option<String>,
    body: String,
    at: Instant,
}

#[derive(Clone)]
enum Reply {
    Status(u16, String, Option<String>),
    Net(NetError),
    Slow(Duration, Box<Reply>),
}

fn ok(body: &str) -> Reply {
    Reply::Status(200, body.into(), None)
}

fn status(code: u16) -> Reply {
    Reply::Status(code, "{\"message\":\"x\"}".into(), None)
}

fn token_reply(n: usize, expires_in: u64) -> Reply {
    ok(&format!(
        "{{\"access_token\":\"tok{n}\",\"expires_in\":{expires_in},\"token_type\":\"bearer\"}}"
    ))
}

type Script = Box<dyn Fn(&Seen, usize) -> Reply + Send + Sync>;

/// `twitch(seen, n)` answers the n-th token request (0-based), `igdb` the n-th IGDB request.
struct MockHttp {
    twitch: Mutex<Script>,
    igdb: Mutex<Script>,
    seen: Mutex<Vec<Seen>>,
    token_calls: AtomicUsize,
    igdb_calls: AtomicUsize,
    open: AtomicUsize,
    peak: AtomicUsize,
}

impl MockHttp {
    fn new() -> Arc<Self> {
        let mock = Self {
            twitch: Mutex::new(Box::new(|_, n| token_reply(n + 1, 5_000_000))),
            igdb: Mutex::new(Box::new(|_, _| ok("[{\"id\":1942,\"name\":\"Game\"}]"))),
            seen: Mutex::new(Vec::new()),
            token_calls: AtomicUsize::new(0),
            igdb_calls: AtomicUsize::new(0),
            open: AtomicUsize::new(0),
            peak: AtomicUsize::new(0),
        };
        Arc::new(mock)
    }
    fn on_twitch(&self, f: impl Fn(&Seen, usize) -> Reply + Send + Sync + 'static) {
        *self.twitch.lock().unwrap() = Box::new(f);
    }
    fn on_igdb(&self, f: impl Fn(&Seen, usize) -> Reply + Send + Sync + 'static) {
        *self.igdb.lock().unwrap() = Box::new(f);
    }
    fn tokens(&self) -> usize {
        self.token_calls.load(Ordering::SeqCst)
    }
    fn igdb(&self) -> usize {
        self.igdb_calls.load(Ordering::SeqCst)
    }
    fn total(&self) -> usize {
        self.tokens() + self.igdb()
    }
    fn seen(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
}

impl HttpExec for MockHttp {
    fn send(&self, request: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, NetError>> {
        let seen = Seen {
            target: request.target,
            client_id: request.client_id.clone(),
            bearer: request.bearer.as_ref().map(|b| b.expose().to_string()),
            body: request.body.expose().to_string(),
            at: Instant::now(),
        };
        self.seen.lock().unwrap().push(seen.clone());
        let reply = match seen.target {
            Target::TwitchToken => {
                let n = self.token_calls.fetch_add(1, Ordering::SeqCst);
                (self.twitch.lock().unwrap())(&seen, n)
            }
            Target::Igdb(_) => {
                let n = self.igdb_calls.fetch_add(1, Ordering::SeqCst);
                (self.igdb.lock().unwrap())(&seen, n)
            }
        };
        Box::pin(async move {
            let open = self.open.fetch_add(1, Ordering::SeqCst) + 1;
            self.peak.fetch_max(open, Ordering::SeqCst);
            let mut reply = reply;
            let result = loop {
                match reply {
                    Reply::Slow(delay, inner) => {
                        tokio::time::sleep(delay).await;
                        reply = *inner;
                    }
                    Reply::Net(error) => break Err(error),
                    Reply::Status(status, body, retry_after) => {
                        break Ok(HttpResponse {
                            status,
                            retry_after,
                            body: body.into_bytes(),
                        })
                    }
                }
            };
            self.open.fetch_sub(1, Ordering::SeqCst);
            result
        })
    }
}

fn creds(id: &str, secret: &str) -> StoredCredentials {
    StoredCredentials {
        client_id: id.into(),
        client_secret: Secret::new(secret.into()),
        verified_at: Some(1_700_000_000),
    }
}

fn service(store: &Arc<MemoryStore>, http: &Arc<MockHttp>) -> IgdbService {
    IgdbService::new(
        store.clone(),
        http.clone(),
        Config {
            inline_store: true,
            ..Config::default()
        },
    )
}

fn empty() -> (Arc<MemoryStore>, Arc<MockHttp>) {
    (Arc::new(MemoryStore::default()), MockHttp::new())
}

fn stored_a() -> (Arc<MemoryStore>, Arc<MockHttp>) {
    (
        Arc::new(MemoryStore::with(&creds(ID_A, SECRET_A))),
        MockHttp::new(),
    )
}

fn secret(value: &str) -> Secret {
    Secret::new(value.into())
}

// ---------------------------------------------------------------------------
// Setting, verifying, replacing and removing credentials

#[tokio::test(start_paused = true)]
async fn valid_credentials_are_verified_then_stored() {
    let (store, http) = empty();
    let svc = service(&store, &http);
    assert_eq!(svc.status().await.state, CredentialState::NotConfigured);

    let status = svc
        .set_credentials(format!("  {ID_A} "), secret(SECRET_A))
        .await
        .unwrap();
    assert_eq!(status.state, CredentialState::Verified);
    assert_eq!(status.storage, StorageState::Secure);
    assert_eq!(status.client_id_hint.as_deref(), Some("aaaa"));
    assert!(!status.verifying);
    assert_eq!(http.tokens(), 1);

    let token_request = &http.seen()[0];
    assert_eq!(token_request.target, Target::TwitchToken);
    assert!(token_request.body.contains("grant_type=client_credentials"));
    assert!(token_request.body.contains(&format!("client_id={ID_A}")));
    assert!(token_request
        .body
        .contains(&format!("client_secret={SECRET_A}")));
    assert_eq!(
        token_request.client_id, None,
        "the secret goes only in the form body"
    );
    assert_eq!(token_request.bearer, None);

    let saved = store.raw().unwrap();
    assert!(saved.contains(ID_A) && saved.contains(SECRET_A));

    // The verification token is reused by queries.
    for _ in 0..3 {
        svc.query("games", GAMES).await.unwrap();
    }
    assert_eq!(http.tokens(), 1);
    assert_eq!(http.igdb(), 3);
}

#[tokio::test(start_paused = true)]
async fn rejected_credentials_are_not_stored() {
    let (store, http) = empty();
    http.on_twitch(|_, _| status(403));
    let svc = service(&store, &http);
    let error = svc
        .set_credentials(ID_A.into(), secret(SECRET_A))
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidCredentials);
    assert_eq!(store.raw(), None);
    assert_eq!(svc.status().await.state, CredentialState::NotConfigured);
}

#[tokio::test(start_paused = true)]
async fn failed_replacement_keeps_working_credentials() {
    for failure in [
        status(400),
        status(403),
        Reply::Net(NetError::Network),
        status(503),
    ] {
        let (store, http) = stored_a();
        let before = store.raw();
        let svc = service(&store, &http);
        svc.query("games", GAMES).await.unwrap();
        assert_eq!(http.tokens(), 1);

        http.on_twitch(move |_, _| failure.clone());
        let error = svc
            .set_credentials(ID_B.into(), secret(SECRET_B))
            .await
            .unwrap_err();
        assert!(matches!(
            error.kind,
            ErrorKind::InvalidCredentials | ErrorKind::Network | ErrorKind::Unavailable
        ));
        assert_eq!(store.raw(), before, "store unchanged");
        assert_eq!(svc.status().await.state, CredentialState::Verified);
        assert_eq!(svc.status().await.client_id_hint.as_deref(), Some("aaaa"));

        // The old credentials and token keep working without a new token request.
        svc.query("games", GAMES).await.unwrap();
        let last = http.seen().last().unwrap().clone();
        assert_eq!(last.client_id.as_deref(), Some(ID_A));
        assert_eq!(last.bearer.as_deref(), Some("tok1"));
    }
}

#[tokio::test(start_paused = true)]
async fn successful_replacement_swaps_credentials_and_token() {
    let (store, http) = stored_a();
    let svc = service(&store, &http);
    svc.query("games", GAMES).await.unwrap();
    let status = svc
        .set_credentials(ID_B.into(), secret(SECRET_B))
        .await
        .unwrap();
    assert_eq!(status.client_id_hint.as_deref(), Some("bbbb"));
    let saved = store.raw().unwrap();
    assert!(saved.contains(ID_B) && saved.contains(SECRET_B));
    assert!(!saved.contains(SECRET_A));

    svc.query("games", GAMES).await.unwrap();
    let last = http.seen().last().unwrap().clone();
    assert_eq!(last.client_id.as_deref(), Some(ID_B));
    assert_eq!(last.bearer.as_deref(), Some("tok2"));
    assert_eq!(http.tokens(), 2);
}

#[tokio::test(start_paused = true)]
async fn invalid_input_is_refused_without_a_request() {
    let (store, http) = empty();
    let svc = service(&store, &http);
    for (id, sec) in [
        ("", SECRET_A),
        (ID_A, ""),
        ("short", SECRET_A),
        (ID_A, "has spaces in it"),
        ("id\r\nX-Injected: 1", SECRET_A),
        (ID_A, "secret&grant_type=password"),
    ] {
        let error = svc
            .set_credentials(id.into(), secret(sec))
            .await
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidInput, "{id:?}");
    }
    assert_eq!(http.total(), 0);
    assert_eq!(store.raw(), None);
}

#[tokio::test(start_paused = true)]
async fn removal_deletes_the_secret_and_the_token() {
    let (store, http) = stored_a();
    let svc = service(&store, &http);
    svc.query("games", GAMES).await.unwrap();
    let status = svc.clear_credentials().await.unwrap();
    assert_eq!(status.state, CredentialState::NotConfigured);
    assert_eq!(status.client_id_hint, None);
    assert_eq!(store.raw(), None);

    let calls = http.total();
    let error = svc.query("games", GAMES).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::MissingCredentials);
    assert_eq!(http.total(), calls, "no request after removal");
    // Removing again is fine.
    svc.clear_credentials().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn missing_credentials_make_no_request() {
    let (store, http) = empty();
    let svc = service(&store, &http);
    let error = svc.query("games", GAMES).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::MissingCredentials);
    let error = svc.verify_credentials().await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::MissingCredentials);
    assert_eq!(http.total(), 0);
}

#[tokio::test(start_paused = true)]
async fn verify_marks_rejected_credentials_invalid_but_keeps_them() {
    let (store, http) = stored_a();
    let before = store.raw();
    http.on_twitch(|_, _| status(403));
    let svc = service(&store, &http);
    let status = svc.verify_credentials().await.unwrap();
    assert_eq!(status.state, CredentialState::Invalid);
    assert_eq!(store.raw(), before);

    // Rejected credentials are not retried in the background.
    let calls = http.total();
    assert_eq!(
        svc.query("games", GAMES).await.unwrap_err().kind,
        ErrorKind::InvalidCredentials
    );
    assert_eq!(http.total(), calls);

    // Verifying again after the user fixed the app on Twitch's side.
    http.on_twitch(|_, n| token_reply(n + 1, 5_000_000));
    assert_eq!(
        svc.verify_credentials().await.unwrap().state,
        CredentialState::Verified
    );
    svc.query("games", GAMES).await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn verify_network_failure_changes_nothing() {
    let (store, http) = stored_a();
    http.on_twitch(|_, _| Reply::Net(NetError::Timeout));
    let svc = service(&store, &http);
    let error = svc.verify_credentials().await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::Network);
    assert_eq!(svc.status().await.state, CredentialState::Verified);
    assert!(store.raw().is_some());
}

#[tokio::test(start_paused = true)]
async fn concurrent_verification_is_refused() {
    let (store, http) = empty();
    http.on_twitch(|_, n| {
        Reply::Slow(
            Duration::from_millis(500),
            Box::new(token_reply(n + 1, 5_000_000)),
        )
    });
    let svc = service(&store, &http);
    let (first, second, third) = tokio::join!(
        svc.set_credentials(ID_A.into(), secret(SECRET_A)),
        async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            assert!(svc.status().await.verifying);
            svc.set_credentials(ID_B.into(), secret(SECRET_B)).await
        },
        async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            svc.verify_credentials().await
        },
    );
    assert_eq!(first.unwrap().state, CredentialState::Verified);
    assert_eq!(second.unwrap_err().kind, ErrorKind::Busy);
    assert_eq!(third.unwrap_err().kind, ErrorKind::Busy);
    assert_eq!(http.tokens(), 1);
    assert!(!svc.status().await.verifying);
}

#[tokio::test(start_paused = true)]
async fn clear_waits_for_a_running_verification() {
    let (store, http) = empty();
    http.on_twitch(|_, n| {
        Reply::Slow(
            Duration::from_millis(500),
            Box::new(token_reply(n + 1, 5_000_000)),
        )
    });
    let svc = service(&store, &http);
    let (set, cleared) = tokio::join!(svc.set_credentials(ID_A.into(), secret(SECRET_A)), async {
        tokio::time::sleep(Duration::from_millis(10)).await;
        svc.clear_credentials().await
    });
    set.unwrap();
    assert_eq!(cleared.unwrap().state, CredentialState::NotConfigured);
    assert_eq!(store.raw(), None, "the later action wins");
}

// ---------------------------------------------------------------------------
// Credential store failures

#[tokio::test(start_paused = true)]
async fn unavailable_store_is_reported_and_retried() {
    let (store, http) = stored_a();
    store.fail_load.store(true, Ordering::SeqCst);
    let svc = service(&store, &http);
    let status = svc.status().await;
    assert_eq!(status.storage, StorageState::Unavailable);
    assert_eq!(status.state, CredentialState::Unavailable);
    assert_eq!(
        svc.query("games", GAMES).await.unwrap_err().kind,
        ErrorKind::StorageUnavailable
    );
    assert_eq!(http.total(), 0);

    store.fail_load.store(false, Ordering::SeqCst);
    assert_eq!(svc.status().await.state, CredentialState::Verified);
    svc.query("games", GAMES).await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn failed_save_keeps_previous_credentials() {
    let (store, http) = stored_a();
    let before = store.raw();
    let svc = service(&store, &http);
    svc.query("games", GAMES).await.unwrap();
    store.fail_save.store(true, Ordering::SeqCst);
    let error = svc
        .set_credentials(ID_B.into(), secret(SECRET_B))
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::StorageUnavailable);
    assert_eq!(store.raw(), before);
    svc.query("games", GAMES).await.unwrap();
    assert_eq!(http.seen().last().unwrap().client_id.as_deref(), Some(ID_A));
}

#[tokio::test(start_paused = true)]
async fn failed_delete_reports_and_keeps_credentials() {
    let (store, http) = stored_a();
    let svc = service(&store, &http);
    svc.query("games", GAMES).await.unwrap();
    store.fail_delete.store(true, Ordering::SeqCst);
    let error = svc.clear_credentials().await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::StorageUnavailable);
    assert!(store.raw().is_some());
    assert_eq!(svc.status().await.state, CredentialState::Verified);
    // The cached token was dropped anyway; the next query mints a new one.
    svc.query("games", GAMES).await.unwrap();
    assert_eq!(http.tokens(), 2);
}

#[tokio::test(start_paused = true)]
async fn corrupted_entry_is_reported_and_recoverable() {
    let (store, http) = empty();
    *store.raw.lock().unwrap() = Some("{garbage".into());
    let svc = service(&store, &http);
    assert_eq!(svc.status().await.state, CredentialState::Corrupted);
    assert_eq!(
        svc.query("games", GAMES).await.unwrap_err().kind,
        ErrorKind::StorageCorrupted
    );
    assert_eq!(http.total(), 0);

    // Replacing overwrites the bad entry.
    svc.set_credentials(ID_A.into(), secret(SECRET_A))
        .await
        .unwrap();
    assert_eq!(svc.status().await.state, CredentialState::Verified);

    // Removing clears a corrupted entry too.
    *store.raw.lock().unwrap() = Some("{garbage".into());
    let fresh = service(&store, &http);
    assert_eq!(fresh.status().await.state, CredentialState::Corrupted);
    assert_eq!(
        fresh.clear_credentials().await.unwrap().state,
        CredentialState::NotConfigured
    );
    assert_eq!(store.raw(), None);
}

#[tokio::test(start_paused = true)]
async fn store_is_read_once() {
    let (store, http) = stored_a();
    let svc = service(&store, &http);
    for _ in 0..3 {
        svc.status().await;
        svc.query("games", GAMES).await.unwrap();
    }
    assert_eq!(store.loads.load(Ordering::SeqCst), 1);
}

// ---------------------------------------------------------------------------
// Tokens

#[tokio::test(start_paused = true)]
async fn token_is_renewed_before_it_expires() {
    let (store, http) = stored_a();
    // A one-hour token renews at half-life.
    http.on_twitch(|_, n| token_reply(n + 1, 3600));
    let svc = service(&store, &http);
    svc.query("games", GAMES).await.unwrap();
    tokio::time::advance(Duration::from_secs(1700)).await;
    svc.query("games", GAMES).await.unwrap();
    assert_eq!(http.tokens(), 1);
    tokio::time::advance(Duration::from_secs(200)).await;
    svc.query("games", GAMES).await.unwrap();
    assert_eq!(http.tokens(), 2);
    assert_eq!(http.seen().last().unwrap().bearer.as_deref(), Some("tok2"));
}

#[tokio::test(start_paused = true)]
async fn long_tokens_renew_a_day_early() {
    let (store, http) = stored_a();
    let lifetime = 60 * 86_400;
    http.on_twitch(move |_, n| token_reply(n + 1, lifetime));
    let svc = service(&store, &http);
    svc.query("games", GAMES).await.unwrap();
    tokio::time::advance(Duration::from_secs(lifetime - 86_400 - 60)).await;
    svc.query("games", GAMES).await.unwrap();
    assert_eq!(http.tokens(), 1);
    tokio::time::advance(Duration::from_secs(120)).await;
    svc.query("games", GAMES).await.unwrap();
    assert_eq!(http.tokens(), 2);
}

#[tokio::test(start_paused = true)]
async fn concurrent_requests_share_one_token_request() {
    let (store, http) = stored_a();
    http.on_twitch(|_, n| {
        Reply::Slow(
            Duration::from_millis(300),
            Box::new(token_reply(n + 1, 5_000_000)),
        )
    });
    let svc = service(&store, &http);
    let results = join_all((0..10).map(|_| svc.query("games", GAMES))).await;
    assert!(results.iter().all(|r| r.is_ok()));
    assert_eq!(http.tokens(), 1);
}

#[tokio::test(start_paused = true)]
async fn concurrent_401s_renew_once() {
    let (store, http) = stored_a();
    // Every request with the first token is refused; the second token works.
    http.on_igdb(|seen, _| {
        if seen.bearer.as_deref() == Some("tok1") {
            status(401)
        } else {
            ok("[]")
        }
    });
    let svc = service(&store, &http);
    let results = join_all((0..6).map(|_| svc.query("games", GAMES))).await;
    assert!(results.iter().all(|r| r.is_ok()));
    assert_eq!(
        http.tokens(),
        2,
        "six 401s with the same token renew it once"
    );
}

#[tokio::test(start_paused = true)]
async fn malformed_token_responses_are_unavailable() {
    for body in [
        "{}",
        "not json",
        "{\"access_token\":\"\",\"expires_in\":100}",
        "{\"access_token\":\"tok\",\"expires_in\":0}",
        "{\"access_token\":\"tok\\r\\nX: y\",\"expires_in\":100}",
        "{\"access_token\":\"tok\"}",
    ] {
        let (store, http) = stored_a();
        let body = body.to_string();
        http.on_twitch(move |_, _| ok(&body));
        let svc = service(&store, &http);
        assert_eq!(
            svc.query("games", GAMES).await.unwrap_err().kind,
            ErrorKind::Unavailable
        );
    }
}

#[tokio::test(start_paused = true)]
async fn twitch_failures_map_to_safe_errors() {
    for (reply, kind) in [
        (Reply::Net(NetError::Network), ErrorKind::Network),
        (Reply::Net(NetError::Timeout), ErrorKind::Network),
        (status(500), ErrorKind::Unavailable),
        (status(429), ErrorKind::RateLimited),
        (status(400), ErrorKind::InvalidCredentials),
        (
            Reply::Slow(Duration::from_secs(60), Box::new(token_reply(1, 100))),
            ErrorKind::Network,
        ),
    ] {
        let (store, http) = stored_a();
        http.on_twitch(move |_, _| reply.clone());
        let svc = service(&store, &http);
        assert_eq!(svc.query("games", GAMES).await.unwrap_err().kind, kind);
        assert_eq!(http.igdb(), 0);
    }
}

// ---------------------------------------------------------------------------
// IGDB responses

#[tokio::test(start_paused = true)]
async fn a_401_renews_the_token_once_and_retries() {
    let (store, http) = stored_a();
    http.on_igdb(|_, n| if n == 0 { status(401) } else { ok("[]") });
    let svc = service(&store, &http);
    svc.query("games", GAMES).await.unwrap();
    assert_eq!(http.tokens(), 2);
    assert_eq!(http.igdb(), 2);
}

#[tokio::test(start_paused = true)]
async fn repeated_401_marks_credentials_invalid() {
    let (store, http) = stored_a();
    http.on_igdb(|_, _| status(401));
    let svc = service(&store, &http);
    let error = svc.query("games", GAMES).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidCredentials);
    assert_eq!(error.status, Some(401));
    assert_eq!(http.tokens(), 2);
    assert_eq!(http.igdb(), 2);
    assert_eq!(svc.status().await.state, CredentialState::Invalid);
    assert!(store.raw().is_some(), "kept for the user to fix");
    let calls = http.total();
    svc.query("games", GAMES).await.unwrap_err();
    assert_eq!(http.total(), calls, "no retry storm");
}

#[tokio::test(start_paused = true)]
async fn a_403_is_not_retried() {
    let (store, http) = stored_a();
    http.on_igdb(|_, _| status(403));
    let svc = service(&store, &http);
    let error = svc.query("games", GAMES).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidCredentials);
    assert_eq!(error.status, Some(403));
    assert_eq!(http.igdb(), 1);
}

#[tokio::test(start_paused = true)]
async fn a_429_backs_off_a_bounded_number_of_times() {
    let (store, http) = stored_a();
    http.on_igdb(|_, _| status(429));
    let svc = service(&store, &http);
    let started = Instant::now();
    let error = svc.query("games", GAMES).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::RateLimited);
    assert_eq!(http.igdb(), 4, "one attempt and three retries");
    assert!(Instant::now() - started >= Duration::from_millis(1750));
}

#[tokio::test(start_paused = true)]
async fn retry_after_is_respected() {
    let (store, http) = stored_a();
    http.on_igdb(|_, n| {
        if n == 0 {
            Reply::Status(429, "{}".into(), Some("2".into()))
        } else {
            ok("[]")
        }
    });
    let svc = service(&store, &http);
    svc.query("games", GAMES).await.unwrap();
    let igdb: Vec<Seen> = http
        .seen()
        .into_iter()
        .filter(|s| s.target != Target::TwitchToken)
        .collect();
    assert!(igdb[1].at - igdb[0].at >= Duration::from_secs(2));
}

#[tokio::test(start_paused = true)]
async fn long_or_invalid_retry_after() {
    // Too long to wait: report it and hold other requests.
    let (store, http) = stored_a();
    http.on_igdb(|_, n| {
        if n == 0 {
            Reply::Status(429, "{}".into(), Some("20".into()))
        } else {
            ok("[]")
        }
    });
    let svc = service(&store, &http);
    let error = svc.query("games", GAMES).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::RateLimited);
    assert_eq!(error.retry_after_ms, Some(20_000));
    assert_eq!(http.igdb(), 1);
    let before = Instant::now();
    svc.query("games", GAMES).await.unwrap();
    assert!(Instant::now() - before >= Duration::from_secs(19));

    // Unparseable values fall back to the fixed backoff.
    for bad in [
        "soon",
        "-1",
        "Wed, 21 Oct 2015 07:28:00 GMT",
        "NaN",
        "1e400",
    ] {
        let (store, http) = stored_a();
        let bad = bad.to_string();
        http.on_igdb(move |_, n| {
            if n == 0 {
                Reply::Status(429, "{}".into(), Some(bad.clone()))
            } else {
                ok("[]")
            }
        });
        let svc = service(&store, &http);
        svc.query("games", GAMES).await.unwrap();
        assert_eq!(http.igdb(), 2);
    }
}

#[tokio::test(start_paused = true)]
async fn server_errors_retry_twice() {
    let (store, http) = stored_a();
    http.on_igdb(|_, _| status(502));
    let svc = service(&store, &http);
    let error = svc.query("games", GAMES).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::Unavailable);
    assert_eq!(error.status, Some(502));
    assert_eq!(http.igdb(), 3);

    let (store, http) = stored_a();
    http.on_igdb(|_, n| if n == 0 { status(503) } else { ok("[]") });
    let svc = service(&store, &http);
    svc.query("games", GAMES).await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn network_failures_retry_once() {
    for failure in [NetError::Network, NetError::Timeout] {
        let (store, http) = stored_a();
        http.on_igdb(move |_, _| Reply::Net(failure));
        let svc = service(&store, &http);
        assert_eq!(
            svc.query("games", GAMES).await.unwrap_err().kind,
            ErrorKind::Network
        );
        assert_eq!(http.igdb(), 2);
    }
}

#[tokio::test(start_paused = true)]
async fn a_hung_request_hits_the_deadline() {
    let (store, http) = stored_a();
    http.on_igdb(|_, _| Reply::Slow(Duration::from_secs(600), Box::new(ok("[]"))));
    let svc = service(&store, &http);
    let started = Instant::now();
    assert_eq!(
        svc.query("games", GAMES).await.unwrap_err().kind,
        ErrorKind::Network
    );
    assert!(Instant::now() - started <= Duration::from_secs(31));
}

#[tokio::test(start_paused = true)]
async fn other_client_errors_and_bad_bodies() {
    for (reply, kind) in [
        (status(400), ErrorKind::BadRequest),
        (status(404), ErrorKind::BadRequest),
        (ok("not json"), ErrorKind::BadResponse),
        (ok("\"a string\""), ErrorKind::BadResponse),
        (ok("42"), ErrorKind::BadResponse),
        (Reply::Net(NetError::TooLarge), ErrorKind::BadResponse),
    ] {
        let (store, http) = stored_a();
        http.on_igdb(move |_, _| reply.clone());
        let svc = service(&store, &http);
        assert_eq!(svc.query("games", GAMES).await.unwrap_err().kind, kind);
        assert_eq!(http.igdb(), 1, "{kind:?} is not retried");
    }
}

// ---------------------------------------------------------------------------
// Rate limiting through the service

#[tokio::test(start_paused = true)]
async fn queries_respect_rate_and_concurrency_limits() {
    let (store, http) = stored_a();
    http.on_igdb(|_, _| Reply::Slow(Duration::from_millis(1500), Box::new(ok("[]"))));
    let svc = service(&store, &http);
    let results = join_all((0..16).map(|_| svc.query("games", GAMES))).await;
    assert!(results.iter().all(|r| r.is_ok()));
    let starts: Vec<Instant> = http
        .seen()
        .into_iter()
        .filter(|s| s.target != Target::TwitchToken)
        .map(|s| s.at)
        .collect();
    assert_eq!(starts.len(), 16);
    for (i, start) in starts.iter().enumerate() {
        let window = starts[i..]
            .iter()
            .filter(|t| **t - *start < Duration::from_secs(1))
            .count();
        assert!(window <= 4);
    }
    assert!(http.peak.load(Ordering::SeqCst) <= 4);
}

// ---------------------------------------------------------------------------
// Input validation at the boundary

#[tokio::test(start_paused = true)]
async fn disallowed_endpoints_and_bodies_never_reach_the_network() {
    let (store, http) = stored_a();
    let svc = service(&store, &http);
    let cases: Vec<(String, String)> = vec![
        ("https://evil.example/".into(), GAMES.into()),
        ("../oauth2/token".into(), GAMES.into()),
        ("games?client_id=x".into(), GAMES.into()),
        ("characters".into(), GAMES.into()),
        ("".into(), GAMES.into()),
        ("games".into(), "".into()),
        ("games".into(), format!("fields {}name;", "a,".repeat(9000))),
        ("games".into(), "fields name; where id = 1; drop;".into()),
        (
            "games".into(),
            "fields name;\r\nAuthorization: Bearer x;".into(),
        ),
        (
            "multiquery".into(),
            "query multiquery \"a\" { fields *; };".into(),
        ),
    ];
    for (endpoint, body) in cases {
        let error = svc.query(&endpoint, &body).await.unwrap_err();
        assert_eq!(error.kind, ErrorKind::BadRequest, "{endpoint}");
    }
    assert_eq!(http.total(), 0);
}

// ---------------------------------------------------------------------------
// Redaction

#[tokio::test(start_paused = true)]
async fn secrets_never_leave_their_requests() {
    let (store, http) = empty();
    let svc = service(&store, &http);
    let mut outputs = Vec::new();
    outputs.push(
        serde_json::to_string(
            &svc.set_credentials(ID_A.into(), secret(SECRET_A))
                .await
                .unwrap(),
        )
        .unwrap(),
    );
    outputs.push(serde_json::to_string(&svc.status().await).unwrap());
    outputs.push(serde_json::to_string(&svc.verify_credentials().await.unwrap()).unwrap());
    outputs.push(serde_json::to_string(&svc.query("games", GAMES).await.unwrap()).unwrap());
    for reply in [
        status(403),
        status(429),
        status(500),
        ok("bad"),
        status(401),
    ] {
        http.on_igdb(move |_, _| reply.clone());
        let error = svc.query("games", GAMES).await.unwrap_err();
        outputs.push(serde_json::to_string(&error).unwrap());
        outputs.push(format!("{error:?}"));
    }
    http.on_twitch(|_, _| status(403));
    let error = svc
        .set_credentials(ID_B.into(), secret(SECRET_B))
        .await
        .unwrap_err();
    outputs.push(serde_json::to_string(&error).unwrap());
    outputs.push(format!("{error:?}"));
    for out in &outputs {
        for needle in [SECRET_A, SECRET_B, ID_A, ID_B, "tok1", "tok2", "Bearer"] {
            assert!(!out.contains(needle), "{needle} leaked into {out}");
        }
    }

    for seen in http.seen() {
        match seen.target {
            Target::TwitchToken => {
                assert_eq!(seen.bearer, None);
                assert_eq!(seen.client_id, None);
            }
            Target::Igdb(_) => {
                assert!(!seen.body.contains(SECRET_A) && !seen.body.contains("client_secret"));
                assert!(seen.bearer.as_deref().is_some_and(|b| b.starts_with("tok")));
            }
        }
    }
}

#[test]
fn errors_serialize_to_the_frontend_shape() {
    let error = super::service::IgdbError::new(ErrorKind::StorageUnsupported);
    let json = serde_json::to_value(&error).unwrap();
    assert_eq!(json["kind"], "storage_unsupported");
    assert!(json["status"].is_null());
    assert!(json["retryAfterMs"].is_null());
    assert!(json["message"].is_string());
}

#[tokio::test(start_paused = true)]
async fn unsupported_platform_is_a_safe_state() {
    let http = MockHttp::new();
    let svc = IgdbService::new(
        Arc::new(super::store::UnsupportedStore),
        http.clone(),
        Config {
            inline_store: true,
            ..Config::default()
        },
    );
    let status = svc.status().await;
    assert_eq!(status.storage, StorageState::Unsupported);
    assert_eq!(status.state, CredentialState::Unavailable);
    assert_eq!(
        svc.set_credentials(ID_A.into(), secret(SECRET_A))
            .await
            .unwrap_err()
            .kind,
        ErrorKind::StorageUnsupported
    );
    assert_eq!(
        svc.query("games", GAMES).await.unwrap_err().kind,
        ErrorKind::StorageUnsupported
    );
    assert_eq!(
        http.total(),
        0,
        "nothing is verified when it can't be stored"
    );
}

// ---------------------------------------------------------------------------
// Real API, run on purpose only. Reads NEXA_IGDB_LIVE_CLIENT_ID and
// NEXA_IGDB_LIVE_CLIENT_SECRET, keeps them in an in-memory store (never the OS
// store) and prints only counts and ids:
// cargo test --lib igdb::tests::live -- --ignored --nocapture

struct Counting {
    inner: super::http::ReqwestExec,
    tokens: AtomicUsize,
    igdb: AtomicUsize,
}

impl HttpExec for Counting {
    fn send(&self, request: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, NetError>> {
        match request.target {
            Target::TwitchToken => self.tokens.fetch_add(1, Ordering::SeqCst),
            Target::Igdb(_) => self.igdb.fetch_add(1, Ordering::SeqCst),
        };
        self.inner.send(request)
    }
}

#[tokio::test]
#[ignore]
async fn live_twitch_and_igdb_round_trip() {
    let id = std::env::var("NEXA_IGDB_LIVE_CLIENT_ID").expect("NEXA_IGDB_LIVE_CLIENT_ID");
    let sec = std::env::var("NEXA_IGDB_LIVE_CLIENT_SECRET").expect("NEXA_IGDB_LIVE_CLIENT_SECRET");
    let http = Arc::new(Counting {
        inner: super::http::ReqwestExec::new(),
        tokens: AtomicUsize::new(0),
        igdb: AtomicUsize::new(0),
    });
    let store = Arc::new(MemoryStore::default());
    let svc = IgdbService::new(store, http.clone(), Config::default());

    let status = svc
        .set_credentials(id, Secret::new(sec))
        .await
        .expect("Twitch auth");
    println!(
        "auth: state={:?} tokens={}",
        status.state,
        http.tokens.load(Ordering::SeqCst)
    );

    let game = svc
        .query(
            "games",
            "fields name,slug,collections; where id = 1942; limit 1;",
        )
        .await
        .expect("game query");
    let game = &game[0];
    println!(
        "game: id=1942 slug={} collections={}",
        game["slug"], game["collections"]
    );

    let search = svc
        .query(
            "games",
            "fields name,slug; search \"witcher\"; where game_type = (0,8,9); limit 5;",
        )
        .await
        .expect("search query");
    println!(
        "search: {} results, first slug={}",
        search.as_array().unwrap().len(),
        search[0]["slug"]
    );

    let collection_id = game["collections"][0].as_u64().expect("a collection id");
    let collection = svc
        .query(
            "collections",
            &format!("fields name,slug,games; where id = {collection_id}; limit 1;"),
        )
        .await
        .expect("collection query");
    println!(
        "collection: id={collection_id} slug={} games={}",
        collection[0]["slug"],
        collection[0]["games"].as_array().map_or(0, |g| g.len())
    );

    let multi = svc
        .query(
            "multiquery",
            "query games \"one\" { fields name; where id = 1942; limit 1; }; query genres \"g\" { fields slug; limit 3; };",
        )
        .await
        .expect("multiquery");
    println!(
        "multiquery: {} named results",
        multi.as_array().unwrap().len()
    );

    let burst = join_all((0..8).map(|i| {
        let body = format!("fields slug; where id = {}; limit 1;", 1940 + i);
        let svc = &svc;
        async move { svc.query("games", &body).await }
    }))
    .await;
    println!("burst: {}/8 ok", burst.iter().filter(|r| r.is_ok()).count());

    let tokens = http.tokens.load(Ordering::SeqCst);
    let igdb = http.igdb.load(Ordering::SeqCst);
    println!("totals: token requests={tokens} igdb requests={igdb}");
    assert_eq!(tokens, 1, "one token reused across every request");
    assert!(burst.iter().all(|r| r.is_ok()));
    assert_eq!(
        svc.verify_credentials().await.unwrap().state,
        CredentialState::Verified
    );
}

/// Replays every Stage 4 Discovery body (the `stage4 *` entries of the
/// TypeScript fixture, recorded from the provider) through the real service:
/// validator, token, limiter and HTTP, against the live API. Prints only case
/// names, result counts and error kinds:
/// cargo test --lib igdb::tests::live_stage4 -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn live_stage4_discovery_bodies() {
    let id = std::env::var("NEXA_IGDB_LIVE_CLIENT_ID").expect("NEXA_IGDB_LIVE_CLIENT_ID");
    let sec = std::env::var("NEXA_IGDB_LIVE_CLIENT_SECRET").expect("NEXA_IGDB_LIVE_CLIENT_SECRET");
    let http = Arc::new(Counting {
        inner: super::http::ReqwestExec::new(),
        tokens: AtomicUsize::new(0),
        igdb: AtomicUsize::new(0),
    });
    let store = Arc::new(MemoryStore::default());
    let svc = IgdbService::new(store, http.clone(), Config::default());
    svc.set_credentials(id, Secret::new(sec))
        .await
        .expect("Twitch auth");

    let fixture = include_str!("../../../tests/fixtures/igdb-query-bodies.json");
    let cases: Vec<serde_json::Value> = serde_json::from_str(fixture).unwrap();
    let mut failed = 0;
    let mut ran = 0;
    for case in cases
        .iter()
        .filter(|c| c["name"].as_str().unwrap_or("").starts_with("stage4 "))
    {
        let name = case["name"].as_str().unwrap();
        let endpoint = case["endpoint"].as_str().unwrap();
        let body = case["body"].as_str().unwrap();
        ran += 1;
        match svc.query(endpoint, body).await {
            Ok(value) => {
                let size = match &value {
                    serde_json::Value::Array(items) => items.len(),
                    serde_json::Value::Object(map) => {
                        map.get("count").and_then(|c| c.as_u64()).unwrap_or(0) as usize
                    }
                    _ => 0,
                };
                println!("{name}: ok ({size})");
            }
            Err(error) => {
                failed += 1;
                println!("{name}: FAILED {:?}", error.kind);
            }
        }
    }
    println!(
        "totals: cases={ran} failed={failed} token requests={} igdb requests={}",
        http.tokens.load(Ordering::SeqCst),
        http.igdb.load(Ordering::SeqCst)
    );
    assert!(ran >= 20, "expected the Stage 4 fixture cases");
    assert_eq!(failed, 0);
}
