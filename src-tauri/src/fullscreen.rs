use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct FullscreenState {
    saved: Arc<Mutex<Option<(i32, i32, u32, u32)>>>,
}

impl FullscreenState {
    pub fn new() -> Self {
        Self {
            saved: Arc::new(Mutex::new(None)),
        }
    }
}

// Window chrome/geometry APIs (set_fullscreen, unmaximize, center, ...) are
// desktop-only in Tauri v2. Mobile is always full-bleed, so entering/exiting
// "fullscreen" there is just an event round-trip for frontend state.
/// Puts the main window into fullscreen, remembering its windowed rect so the
/// matching exit can restore it. Shared by the frontend command and the launch
/// path so there is a single place that calls `set_fullscreen(true)`.
#[cfg(desktop)]
pub(crate) fn enter_fullscreen_now(
    app: &AppHandle,
    state: &FullscreenState,
) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    let already_fs = main.is_fullscreen().unwrap_or(false);
    if !already_fs {
        if let (Ok(pos), Ok(sz)) = (main.outer_position(), main.inner_size()) {
            *state.saved.lock().unwrap() = Some((pos.x, pos.y, sz.width, sz.height));
        }
        if main.is_maximized().unwrap_or(false) {
            let _ = main.unmaximize();
        }
        main.set_fullscreen(true)
            .map_err(|e| format!("set_fullscreen(true): {}", e))?;
        let _ = main.set_focus();
    }
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
pub async fn window_fullscreen_enter(
    app: AppHandle,
    state: State<'_, FullscreenState>,
) -> Result<(), String> {
    enter_fullscreen_now(&app, &state)?;
    let _ = app.emit_to("main", "fs://entered", ());
    Ok(())
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn window_fullscreen_enter(
    app: AppHandle,
    _state: State<'_, FullscreenState>,
) -> Result<(), String> {
    let _ = app.emit_to("main", "fs://entered", ());
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
pub async fn window_fullscreen_exit(
    app: AppHandle,
    state: State<'_, FullscreenState>,
    restore_position: Option<bool>,
) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    let is_fs = main.is_fullscreen().unwrap_or(false);
    if is_fs {
        main.set_fullscreen(false)
            .map_err(|e| format!("set_fullscreen(false): {}", e))?;
        let saved = state.saved.lock().unwrap().take();
        if let Some((x, y, w, h)) = saved {
            let _ = main.set_size(tauri::PhysicalSize { width: w, height: h });
            if restore_position.unwrap_or(true) {
                let _ = main.set_position(tauri::PhysicalPosition { x, y });
            } else {
                let _ = main.center();
            }
        } else {
            let _ = main.center();
        }
        let _ = main.set_focus();
    }
    let _ = app.emit_to("main", "fs://exited", ());
    Ok(())
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn window_fullscreen_exit(
    app: AppHandle,
    _state: State<'_, FullscreenState>,
    _restore_position: Option<bool>,
) -> Result<(), String> {
    let _ = app.emit_to("main", "fs://exited", ());
    Ok(())
}
