//! Captures an addon's `stremio://` Install link from Nexa's addon installer.
//!
//! Addon configuration pages (Torrentio, ...) run in an iframe inside the main
//! window, and their Install button is a plain `stremio://<host>/<config>/manifest.json`
//! link that navigates that iframe. Left alone, the main window's CSP
//! (`frame-src`) blocks the navigation and the iframe shows an error page; and
//! even when allowed it would be handed to whatever app owns the scheme.
//!
//! On Windows every iframe of the main webview gets a frame-level
//! NavigationStarting handler. Any `stremio:` navigation of an iframe is
//! cancelled; it is forwarded to the frontend only when it comes from the
//! installer iframe of the currently armed session (its `name` carries a random
//! per-session token the installer chose). Other embedded pages cannot start an
//! install, and no URL is ever logged: configuration paths can carry debrid keys.

use std::sync::Mutex;

/// Prefix of the installer iframe's name; the rest is the session token.
pub const INSTALLER_FRAME_PREFIX: &str = "harbor-installer-";
/// Event sent to the main window with `{ token, url }`.
pub const CAPTURE_EVENT: &str = "harbor://installer-stremio-capture";
/// Longest link forwarded. The frontend validation caps the manifest URL at
/// 2000 characters; anything far beyond that is not an install link.
pub const MAX_CAPTURED_URI: usize = 4096;

#[derive(Default)]
pub struct InstallerCaptureState {
    armed: Mutex<Option<String>>,
}

/// What to do with an iframe navigation.
#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    /// Not a stremio link: leave it alone.
    Allow,
    /// A stremio link from anywhere but the armed installer: cancel, drop.
    Cancel,
    /// The armed installer's Install link: cancel and forward.
    Capture,
}

/// A session token is 16-64 ASCII letters/digits (the installer uses 32 hex).
pub fn valid_token(token: &str) -> bool {
    (16..=64).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_alphanumeric())
}

pub fn is_stremio_uri(uri: &str) -> bool {
    uri.get(..10)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("stremio://"))
}

pub fn decide(uri: &str, frame_name: &str, armed: Option<&str>) -> Decision {
    if !is_stremio_uri(uri) {
        return Decision::Allow;
    }
    let Some(token) = armed else {
        return Decision::Cancel;
    };
    let from_installer = frame_name
        .strip_prefix(INSTALLER_FRAME_PREFIX)
        .is_some_and(|t| t == token);
    let well_formed = uri.len() <= MAX_CAPTURED_URI && !uri.chars().any(char::is_control);
    if from_installer && well_formed {
        Decision::Capture
    } else {
        Decision::Cancel
    }
}

/// Arms capture for one installer session.
#[tauri::command]
pub fn installer_capture_arm(
    state: tauri::State<'_, InstallerCaptureState>,
    token: String,
) -> Result<(), String> {
    if !valid_token(&token) {
        return Err("invalid installer token".into());
    }
    *state.armed.lock().unwrap() = Some(token);
    Ok(())
}

/// Disarms capture, if this session is the armed one.
#[tauri::command]
pub fn installer_capture_disarm(state: tauri::State<'_, InstallerCaptureState>, token: String) {
    let mut armed = state.armed.lock().unwrap();
    if armed.as_deref() == Some(token.as_str()) {
        *armed = None;
    }
}

/// Hooks every iframe of the main webview (Windows).
#[cfg(windows)]
pub fn install(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let app = app.clone();
    let res = main.with_webview(move |webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Frame2, ICoreWebView2_4};
        use webview2_com::{FrameCreatedEventHandler, FrameNavigationStartingEventHandler};
        use windows::core::{Interface, PWSTR};

        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(core4) = core.cast::<ICoreWebView2_4>() else {
            eprintln!("[harbor::installer-capture] WebView2 too old for frame events");
            return;
        };
        let app_frames = app.clone();
        let on_frame = FrameCreatedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let frame = args.Frame()?;
            let Ok(frame2) = frame.cast::<ICoreWebView2Frame2>() else {
                return Ok(());
            };
            let app_nav = app_frames.clone();
            let on_nav = FrameNavigationStartingEventHandler::create(Box::new(move |sender, args| {
                let (Some(sender), Some(args)) = (sender, args) else {
                    return Ok(());
                };
                let uri = {
                    let mut p = PWSTR::null();
                    args.Uri(&mut p)?;
                    webview2_com::take_pwstr(p)
                };
                if !is_stremio_uri(&uri) {
                    return Ok(());
                }
                // Read the name now, not at creation: it is the frame's current name.
                let name = {
                    let mut p = PWSTR::null();
                    sender.Name(&mut p)?;
                    webview2_com::take_pwstr(p)
                };
                let state = app_nav.state::<InstallerCaptureState>();
                let armed = state.armed.lock().unwrap().clone();
                let token = armed.clone();
                match decide(&uri, &name, armed.as_deref()) {
                    Decision::Allow => {}
                    Decision::Cancel => {
                        args.SetCancel(true)?;
                    }
                    Decision::Capture => {
                        args.SetCancel(true)?;
                        use tauri::Emitter;
                        let _ = app_nav.emit_to(
                            "main",
                            CAPTURE_EVENT,
                            serde_json::json!({ "token": token, "url": uri }),
                        );
                    }
                }
                Ok(())
            }));
            let mut token = Default::default();
            frame2.add_NavigationStarting(&on_nav, &mut token)?;
            Ok(())
        }));
        let mut token = Default::default();
        if core4.add_FrameCreated(&on_frame, &mut token).is_err() {
            eprintln!("[harbor::installer-capture] could not hook frames");
        }
    });
    if res.is_err() {
        eprintln!("[harbor::installer-capture] main webview unavailable");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";
    const LINK: &str = "stremio://torrentio.strem.fun/providers=yts/manifest.json";

    fn installer() -> String {
        format!("{INSTALLER_FRAME_PREFIX}{TOKEN}")
    }

    #[test]
    fn the_armed_installers_install_link_is_captured() {
        assert_eq!(decide(LINK, &installer(), Some(TOKEN)), Decision::Capture);
        assert_eq!(
            decide("STREMIO://torrentio.strem.fun/manifest.json", &installer(), Some(TOKEN)),
            Decision::Capture
        );
    }

    #[test]
    fn other_frames_never_start_an_install() {
        // A different frame, a different session, or nothing armed.
        assert_eq!(decide(LINK, "not-the-installer", Some(TOKEN)), Decision::Cancel);
        assert_eq!(decide(LINK, "", Some(TOKEN)), Decision::Cancel);
        let other = format!("{INSTALLER_FRAME_PREFIX}ffffffffffffffffffffffffffffffff");
        assert_eq!(decide(LINK, &other, Some(TOKEN)), Decision::Cancel);
        assert_eq!(decide(LINK, &installer(), None), Decision::Cancel);
        // A prefix trick: the name must equal prefix + token exactly.
        assert_eq!(decide(LINK, &format!("{}x", installer()), Some(TOKEN)), Decision::Cancel);
    }

    #[test]
    fn ordinary_navigation_is_untouched() {
        for uri in [
            "https://torrentio.strem.fun/configure",
            "about:blank",
            "http://example.com/stremio://x",
            "stremio:/x",
            "",
        ] {
            assert_eq!(decide(uri, &installer(), Some(TOKEN)), Decision::Allow, "{uri}");
        }
    }

    #[test]
    fn malformed_links_are_cancelled_not_forwarded() {
        let long = format!("stremio://h/{}", "a".repeat(MAX_CAPTURED_URI));
        assert_eq!(decide(&long, &installer(), Some(TOKEN)), Decision::Cancel);
        assert_eq!(
            decide("stremio://h/a\nb/manifest.json", &installer(), Some(TOKEN)),
            Decision::Cancel
        );
    }

    #[test]
    fn non_ascii_never_panics() {
        assert_eq!(decide("stré", &installer(), Some(TOKEN)), Decision::Allow);
        assert_eq!(decide("ストレミオ://x", &installer(), Some(TOKEN)), Decision::Allow);
    }

    #[test]
    fn tokens_are_validated() {
        assert!(valid_token(TOKEN));
        assert!(!valid_token("short"));
        assert!(!valid_token(&"a".repeat(65)));
        assert!(!valid_token("0123456789abcdef-0123456789abcde"));
        assert!(!valid_token(""));
    }
}
