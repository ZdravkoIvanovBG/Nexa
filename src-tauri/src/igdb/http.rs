//! The only two destinations IGDB support talks to. URLs are built here from
//! fixed constants and an allowlisted `'static` endpoint name; nothing from the
//! frontend can change the scheme, host, path prefix or headers.

use std::time::Duration;

use futures_util::future::BoxFuture;

use super::secret::Secret;

pub const IGDB_API_BASE: &str = "https://api.igdb.com/v4/";
pub const TWITCH_TOKEN_URL: &str = "https://id.twitch.tv/oauth2/token";

/// Largest response body accepted from either host.
pub const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    /// POST https://id.twitch.tv/oauth2/token (client-credentials grant).
    TwitchToken,
    /// POST https://api.igdb.com/v4/{endpoint}, endpoint from the allowlist.
    Igdb(&'static str),
}

/// Debug output never shows the bearer token or the body.
#[derive(Debug)]
pub struct HttpRequest {
    pub target: Target,
    pub client_id: Option<String>,
    pub bearer: Option<Secret>,
    /// Holds the Client Secret for token requests, so it's always a Secret.
    pub body: Secret,
}

pub struct HttpResponse {
    pub status: u16,
    pub retry_after: Option<String>,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetError {
    Timeout,
    Network,
    TooLarge,
}

pub trait HttpExec: Send + Sync + 'static {
    fn send(&self, request: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, NetError>>;
}

pub fn url_for(target: Target) -> String {
    match target {
        Target::TwitchToken => TWITCH_TOKEN_URL.to_string(),
        Target::Igdb(endpoint) => format!("{IGDB_API_BASE}{endpoint}"),
    }
}

/// reqwest-backed transport: HTTPS only, no redirects (so credentials can't be
/// forwarded anywhere), bounded time and response size.
pub struct ReqwestExec {
    client: Option<reqwest::Client>,
}

impl ReqwestExec {
    pub fn new() -> Self {
        // Mirrors http_fetch's client setup (no system proxy, hickory DNS).
        let client = reqwest::Client::builder()
            .no_proxy()
            .hickory_dns(true)
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .pool_idle_timeout(Duration::from_secs(60))
            .pool_max_idle_per_host(4)
            .build()
            .ok();
        Self { client }
    }
}

fn map_error(error: reqwest::Error) -> NetError {
    // The error itself is dropped: its Display can include the URL.
    if error.is_timeout() {
        NetError::Timeout
    } else {
        NetError::Network
    }
}

impl HttpExec for ReqwestExec {
    fn send(&self, request: HttpRequest) -> BoxFuture<'_, Result<HttpResponse, NetError>> {
        Box::pin(async move {
            use reqwest::header::{HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
            let client = self.client.as_ref().ok_or(NetError::Network)?;
            let content_type = match request.target {
                Target::TwitchToken => "application/x-www-form-urlencoded",
                Target::Igdb(_) => "text/plain",
            };
            let mut builder = client
                .post(url_for(request.target))
                .header(ACCEPT, "application/json")
                .header(CONTENT_TYPE, content_type);
            if let Some(id) = request.client_id.as_deref() {
                let mut value = HeaderValue::from_str(id).map_err(|_| NetError::Network)?;
                value.set_sensitive(true);
                builder = builder.header("Client-ID", value);
            }
            if let Some(token) = request.bearer.as_ref() {
                let bearer = Secret::new(format!("Bearer {}", token.expose()));
                let mut value =
                    HeaderValue::from_str(bearer.expose()).map_err(|_| NetError::Network)?;
                value.set_sensitive(true);
                builder = builder.header(AUTHORIZATION, value);
            }
            let mut response = builder
                .body(request.body.expose().to_string())
                .send()
                .await
                .map_err(map_error)?;
            let status = response.status().as_u16();
            let retry_after = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|v| v.to_str().ok())
                .map(|v| v.chars().take(64).collect());
            if response
                .content_length()
                .is_some_and(|n| n as usize > MAX_RESPONSE_BYTES)
            {
                return Err(NetError::TooLarge);
            }
            let mut body = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(map_error)? {
                if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                    return Err(NetError::TooLarge);
                }
                body.extend_from_slice(&chunk);
            }
            Ok(HttpResponse {
                status,
                retry_after,
                body,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_are_fixed() {
        assert_eq!(
            url_for(Target::TwitchToken),
            "https://id.twitch.tv/oauth2/token"
        );
        assert_eq!(
            url_for(Target::Igdb("games")),
            "https://api.igdb.com/v4/games"
        );
        assert_eq!(
            url_for(Target::Igdb("games/count")),
            "https://api.igdb.com/v4/games/count"
        );
    }

    #[test]
    fn request_debug_hides_token_and_body() {
        let request = HttpRequest {
            target: Target::Igdb("games"),
            client_id: Some("idvalue".into()),
            bearer: Some(Secret::new("tokvalue".into())),
            body: Secret::new("client_secret=secretvalue".into()),
        };
        let printed = format!("{request:?}");
        assert!(!printed.contains("tokvalue"));
        assert!(!printed.contains("secretvalue"));
    }
}
