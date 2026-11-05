//! Tauri commands. Each checks that it was called from Nexa's own main
//! webview (not the in-app browser, a PiP window or remote content) before
//! doing anything.

use std::sync::Arc;

use tauri::{State, Webview};

use super::http::ReqwestExec;
use super::secret::Secret;
use super::service::{Config, ErrorKind, IgdbError, IgdbService, IgdbStatus};
use super::store::platform_store;

pub type IgdbState = Arc<IgdbService>;

/// One service for the whole process, shared by every window.
pub fn production_state() -> IgdbState {
    Arc::new(IgdbService::new(
        platform_store(),
        Arc::new(ReqwestExec::new()),
        Config::default(),
    ))
}

/// The main window serving Nexa's bundled frontend (or the dev server in
/// debug builds).
pub(crate) fn is_trusted_origin(label: &str, url: &url::Url) -> bool {
    if label != "main" {
        return false;
    }
    let dev_server = cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    dev_server
        || matches!(
            (url.scheme(), url.host_str()),
            ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
        )
}

fn require_trusted(webview: &Webview) -> Result<(), IgdbError> {
    let url = webview
        .url()
        .map_err(|_| IgdbError::new(ErrorKind::Forbidden))?;
    if is_trusted_origin(webview.label(), &url) {
        Ok(())
    } else {
        Err(IgdbError::new(ErrorKind::Forbidden))
    }
}

/// Safe status only: storage support, credential state, a 4-character Client ID hint.
#[tauri::command]
pub async fn igdb_status(
    webview: Webview,
    state: State<'_, IgdbState>,
) -> Result<IgdbStatus, IgdbError> {
    require_trusted(&webview)?;
    Ok(state.status().await)
}

/// The only command that accepts the Client Secret. Verifies with Twitch
/// first and stores only on success.
#[tauri::command]
pub async fn igdb_set_credentials(
    webview: Webview,
    state: State<'_, IgdbState>,
    client_id: String,
    client_secret: String,
) -> Result<IgdbStatus, IgdbError> {
    let client_secret = Secret::new(client_secret);
    require_trusted(&webview)?;
    state.set_credentials(client_id, client_secret).await
}

#[tauri::command]
pub async fn igdb_verify_credentials(
    webview: Webview,
    state: State<'_, IgdbState>,
) -> Result<IgdbStatus, IgdbError> {
    require_trusted(&webview)?;
    state.verify_credentials().await
}

#[tauri::command]
pub async fn igdb_clear_credentials(
    webview: Webview,
    state: State<'_, IgdbState>,
) -> Result<IgdbStatus, IgdbError> {
    require_trusted(&webview)?;
    state.clear_credentials().await
}

/// One IGDB request: an allowlisted endpoint name and an Apicalypse body.
#[tauri::command]
pub async fn igdb_query(
    webview: Webview,
    state: State<'_, IgdbState>,
    endpoint: String,
    body: String,
) -> Result<serde_json::Value, IgdbError> {
    require_trusted(&webview)?;
    state.query(&endpoint, &body).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> url::Url {
        url::Url::parse(s).unwrap()
    }

    #[test]
    fn only_the_main_bundled_webview_is_trusted() {
        assert!(is_trusted_origin("main", &url("http://tauri.localhost/")));
        assert!(is_trusted_origin(
            "main",
            &url("https://tauri.localhost/settings")
        ));
        assert!(is_trusted_origin("main", &url("tauri://localhost/")));
        assert_eq!(
            is_trusted_origin("main", &url("http://localhost:1420/")),
            cfg!(debug_assertions)
        );
        for (label, u) in [
            ("harbor-browser", "http://tauri.localhost/"),
            ("harbor-pip", "http://tauri.localhost/"),
            ("harbor-modal-overlay", "http://tauri.localhost/"),
            ("harbor-hdr-overlay", "http://tauri.localhost/"),
            ("main", "https://evil.example/"),
            ("main", "https://tauri.localhost.evil.example/"),
            ("main", "http://evil.example/?h=tauri.localhost"),
            ("main", "file:///C:/x.html"),
            ("main", "data:text/html,hi"),
        ] {
            assert!(!is_trusted_origin(label, &url(u)), "{label} {u}");
        }
    }
}
