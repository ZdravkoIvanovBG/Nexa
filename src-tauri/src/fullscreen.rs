use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

// Main-window fullscreen controller.
//
// Launch is always true fullscreen. Entering fullscreen captures the window's
// placement (normal rect + whether it was maximized); leaving restores it, so
// the window is a real Windows normal or maximized window afterwards, never a
// maximize-sized "normal" window. Two exits exist:
//   ExitTarget::Normal   - the title-bar Maximize/Restore button: always a
//                          normal, draggable, resizable window.
//   ExitTarget::Previous - F11, Esc, player, PiP, close: back to what the window
//                          was before fullscreen.
//
// Locking rule: no lock is held across a native window call. Mutexes only
// guard reads/writes of saved values; `busy` makes an overlapping or
// re-entrant transition a no-op instead of a wait.
//
// Placement capture is Windows-only; on macOS/Linux exits restore the saved
// windowed rect as before.

/// How a fullscreen exit should leave the window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExitTarget {
    Previous,
    Normal,
}

/// The window's resting state, captured before entering fullscreen or PiP.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SavedPlacement {
    pub maximized: bool,
    /// The normal (restored) rect in the coordinate space of
    /// Get/SetWindowPlacement: left, top, right, bottom.
    pub normal: (i32, i32, i32, i32),
}

pub struct FullscreenState {
    saved: Arc<Mutex<Option<(i32, i32, u32, u32)>>>,
    placement: Arc<Mutex<Option<SavedPlacement>>>,
    busy: Arc<AtomicBool>,
}

impl FullscreenState {
    pub fn new() -> Self {
        Self {
            saved: Arc::new(Mutex::new(None)),
            placement: Arc::new(Mutex::new(None)),
            busy: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Clears `busy` when a transition ends, however it ends.
struct BusyGuard(Arc<AtomicBool>);

impl BusyGuard {
    fn try_acquire(flag: &Arc<AtomicBool>) -> Option<Self> {
        if flag.swap(true, Ordering::SeqCst) {
            None
        } else {
            Some(Self(flag.clone()))
        }
    }
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// Which show state an exit applies, given what was captured.
pub fn exit_show_maximized(saved: &SavedPlacement, target: ExitTarget) -> bool {
    match target {
        ExitTarget::Normal => false,
        ExitTarget::Previous => saved.maximized,
    }
}

#[cfg(windows)]
mod win {
    use super::SavedPlacement;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowPlacement, SetWindowPlacement, SW_SHOWMAXIMIZED, SW_SHOWNORMAL, WINDOWPLACEMENT,
        WPF_RESTORETOMAXIMIZED,
    };

    fn empty() -> WINDOWPLACEMENT {
        WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        }
    }

    pub fn capture(hwnd: HWND) -> Option<SavedPlacement> {
        let mut wp = empty();
        unsafe { GetWindowPlacement(hwnd, &mut wp) }.ok()?;
        let show = wp.showCmd as i32;
        // A minimized window remembers whether it restores to maximized.
        let restores_maximized = (wp.flags & WPF_RESTORETOMAXIMIZED) == WPF_RESTORETOMAXIMIZED;
        let maximized =
            show == SW_SHOWMAXIMIZED.0 || (restores_maximized && show != SW_SHOWNORMAL.0);
        let r = wp.rcNormalPosition;
        Some(SavedPlacement {
            maximized,
            normal: (r.left, r.top, r.right, r.bottom),
        })
    }

    pub fn apply(hwnd: HWND, saved: &SavedPlacement, maximized: bool) -> bool {
        let mut wp = empty();
        // Start from the live placement so ptMinPosition/ptMaxPosition stay valid.
        if unsafe { GetWindowPlacement(hwnd, &mut wp) }.is_err() {
            wp = empty();
        }
        let (left, top, right, bottom) = saved.normal;
        wp.rcNormalPosition = RECT {
            left,
            top,
            right,
            bottom,
        };
        wp.flags = Default::default();
        wp.showCmd = if maximized {
            SW_SHOWMAXIMIZED.0 as u32
        } else {
            SW_SHOWNORMAL.0 as u32
        };
        unsafe { SetWindowPlacement(hwnd, &wp) }.is_ok()
    }
}

/// The main window's current placement. Windows only: elsewhere this is None
/// and fullscreen exits keep the saved-rect restore they always used.
#[cfg(desktop)]
pub(crate) fn capture_placement(main: &tauri::WebviewWindow) -> Option<SavedPlacement> {
    #[cfg(windows)]
    {
        main.hwnd().ok().and_then(win::capture)
    }
    #[cfg(not(windows))]
    {
        let _ = main;
        None
    }
}

/// Applies a placement. Must run on the main thread, after any pending
/// window message (e.g. tao's own fullscreen exit), so it has the last word.
#[cfg(desktop)]
fn apply_placement_now(main: &tauri::WebviewWindow, saved: &SavedPlacement, maximized: bool) {
    #[cfg(windows)]
    if let Ok(hwnd) = main.hwnd() {
        win::apply(hwnd, saved, maximized);
    }
    #[cfg(not(windows))]
    {
        let _ = saved;
        if maximized {
            let _ = main.maximize();
        }
    }
}

/// Queues a placement restore on the main thread and waits for it. Window
/// setters called from a command thread are queued in the same order, so this
/// runs after them.
#[cfg(desktop)]
pub(crate) async fn apply_placement(
    app: &AppHandle,
    main: &tauri::WebviewWindow,
    saved: SavedPlacement,
    maximized: bool,
    center_if_normal: bool,
) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let win_main = main.clone();
    app.run_on_main_thread(move || {
        apply_placement_now(&win_main, &saved, maximized);
        if !maximized && center_if_normal {
            let _ = win_main.center();
        }
        let _ = tx.send(());
    })
    .map_err(|e| format!("run_on_main_thread: {}", e))?;
    let _ = rx.await;
    Ok(())
}

// Window chrome/geometry APIs (set_fullscreen, unmaximize, center, ...) are
// desktop-only in Tauri v2. Mobile is always full-bleed, so entering/exiting
// "fullscreen" there is just an event round-trip for frontend state.
/// Puts the main window into fullscreen, remembering how to restore it. Shared
/// by the frontend command, PiP and the launch path so there is a single place
/// that calls `set_fullscreen(true)`.
#[cfg(desktop)]
pub(crate) fn enter_fullscreen_now(
    app: &AppHandle,
    state: &FullscreenState,
) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    let Some(_busy) = BusyGuard::try_acquire(&state.busy) else {
        return Ok(());
    };
    let already_fs = main.is_fullscreen().unwrap_or(false);
    if !already_fs {
        *state.placement.lock().unwrap() = capture_placement(&main);
        if let (Ok(pos), Ok(sz)) = (main.outer_position(), main.inner_size()) {
            *state.saved.lock().unwrap() = Some((pos.x, pos.y, sz.width, sz.height));
        }
        // Fullscreen from a maximized window must start from a normal one: a
        // window that stays maximized comes back covering the taskbar. The
        // captured placement still remembers "maximized" for the way back.
        if main.is_maximized().unwrap_or(false) {
            let _ = main.unmaximize();
        }
        main.set_fullscreen(true)
            .map_err(|e| format!("set_fullscreen(true): {}", e))?;
        let _ = main.set_focus();
    }
    Ok(())
}

/// Leaves fullscreen. Returns Ok(false) when nothing happened (not fullscreen,
/// or another transition was running).
#[cfg(desktop)]
pub(crate) async fn exit_fullscreen(
    app: &AppHandle,
    state: &FullscreenState,
    target: ExitTarget,
    restore_position: bool,
) -> Result<bool, String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    let Some(_busy) = BusyGuard::try_acquire(&state.busy) else {
        return Ok(false);
    };
    if !main.is_fullscreen().unwrap_or(false) {
        return Ok(false);
    }

    let placement = *state.placement.lock().unwrap();
    main.set_fullscreen(false)
        .map_err(|e| format!("set_fullscreen(false): {}", e))?;
    if let Some(saved) = placement {
        let maximized = exit_show_maximized(&saved, target);
        apply_placement(app, &main, saved, maximized, !restore_position).await?;
    } else {
        // No placement (macOS/Linux): restore the saved windowed rect.
        let saved = state.saved.lock().unwrap().take();
        if let Some((x, y, w, h)) = saved {
            let _ = main.set_size(tauri::PhysicalSize { width: w, height: h });
            if restore_position {
                let _ = main.set_position(tauri::PhysicalPosition { x, y });
            } else {
                let _ = main.center();
            }
        } else {
            let _ = main.center();
        }
    }
    let _ = main.set_focus();
    Ok(true)
}

/// Synchronous exit for the close/quit paths, which run on the main thread and
/// cannot await. Restores the pre-fullscreen state so the window-state plugin
/// saves the real normal rect and the maximized flag.
#[cfg(desktop)]
pub(crate) fn exit_fullscreen_for_close(main: &tauri::WebviewWindow) {
    if !main.is_fullscreen().unwrap_or(false) {
        return;
    }
    let state = main.app_handle().state::<FullscreenState>();
    let placement = *state.placement.lock().unwrap();
    let _ = main.set_fullscreen(false);
    if let Some(saved) = placement {
        apply_placement_now(main, &saved, saved.maximized);
    }
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
    to_normal: Option<bool>,
) -> Result<(), String> {
    let target = if to_normal.unwrap_or(false) {
        ExitTarget::Normal
    } else {
        ExitTarget::Previous
    };
    let ran = exit_fullscreen(&app, &state, target, restore_position.unwrap_or(true)).await?;
    // An overlapping exit is a no-op; the transition that runs announces it.
    if ran || !state.busy.load(Ordering::SeqCst) {
        let _ = app.emit_to("main", "fs://exited", ());
    }
    Ok(())
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn window_fullscreen_exit(
    app: AppHandle,
    _state: State<'_, FullscreenState>,
    _restore_position: Option<bool>,
    _to_normal: Option<bool>,
) -> Result<(), String> {
    let _ = app.emit_to("main", "fs://exited", ());
    Ok(())
}

// ---------------------------------------------------------------------------
// One-time repair of window state saved by v0.11.0 and earlier.
//
// The legacy fullscreen exit resized a *normal* window to the exact size of a
// maximized one and the window-state plugin saved it, so every later launch
// restored a "normal" window that exactly covers the work area (or the whole
// monitor, when saved during fullscreen). The check runs once per installation
// and only matches that exact signature; any other size, including windows
// that are merely close to the screen size, is the user's and is kept.
// ---------------------------------------------------------------------------

/// A rectangle in physical pixels: x, y, width, height.
pub type PhysRect = (i32, i32, u32, u32);

/// Largest invisible resize-border inset Windows adds around a window.
#[cfg_attr(not(windows), allow(dead_code))]
const LEGACY_INSET_MAX: i32 = 16;

/// True only for the exact legacy signature: an un-maximized window whose
/// client area is exactly the work area (or monitor) and whose outer position
/// sits on that area's origin, offset by at most the invisible border inset.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn is_legacy_screen_sized(
    maximized: bool,
    outer_pos: (i32, i32),
    inner_size: (u32, u32),
    areas: &[PhysRect],
) -> bool {
    if maximized {
        return false;
    }
    areas.iter().any(|&(ax, ay, aw, ah)| {
        inner_size == (aw, ah)
            && (ax - LEGACY_INSET_MAX..=ax).contains(&outer_pos.0)
            && (ay - LEGACY_INSET_MAX..=ay).contains(&outer_pos.1)
    })
}

/// Default normal size (logical 1280x800), clamped to 90% of the work area and
/// never below the window minimum, centered in the work area. Physical pixels.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn repaired_normal_rect(work: PhysRect, scale: f64) -> PhysRect {
    let (wx, wy, ww, wh) = work;
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let min_w = (800.0 * scale).round() as u32;
    let min_h = (560.0 * scale).round() as u32;
    let w = ((1280.0 * scale).round() as u32)
        .min((ww as f64 * 0.9) as u32)
        .max(min_w.min(ww));
    let h = ((800.0 * scale).round() as u32)
        .min((wh as f64 * 0.9) as u32)
        .max(min_h.min(wh));
    let x = wx + (ww.saturating_sub(w) / 2) as i32;
    let y = wy + (wh.saturating_sub(h) / 2) as i32;
    (x, y, w, h)
}

#[cfg_attr(not(windows), allow(dead_code))]
const REPAIR_MARKER: &str = "window-state-check.v1";

/// Runs once per installation, after the window-state plugin restored the main
/// window and before launch fullscreen. A matching window gets a normal default
/// size and is maximized, which is what the legacy state looked like to the user.
#[cfg(windows)]
pub(crate) fn repair_legacy_window_state_once(app: &AppHandle) {
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let marker = dir.join(REPAIR_MARKER);
    if marker.exists() {
        return;
    }
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let maximized = main.is_maximized().unwrap_or(false);
    let (Ok(pos), Ok(inner), Ok(Some(monitor))) =
        (main.outer_position(), main.inner_size(), main.current_monitor())
    else {
        return;
    };
    let work = monitor.work_area();
    let work_rect: PhysRect = (
        work.position.x,
        work.position.y,
        work.size.width,
        work.size.height,
    );
    let mon_rect: PhysRect = (
        monitor.position().x,
        monitor.position().y,
        monitor.size().width,
        monitor.size().height,
    );
    let repaired = is_legacy_screen_sized(
        maximized,
        (pos.x, pos.y),
        (inner.width, inner.height),
        &[work_rect, mon_rect],
    );
    if repaired {
        let (x, y, w, h) = repaired_normal_rect(work_rect, monitor.scale_factor());
        let _ = main.set_size(tauri::PhysicalSize { width: w, height: h });
        let _ = main.set_position(tauri::PhysicalPosition { x, y });
        let _ = main.maximize();
        eprintln!("[harbor::window] repaired a legacy screen-sized window state");
    }
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&marker, if repaired { "repaired\n" } else { "ok\n" });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn placement(maximized: bool) -> SavedPlacement {
        SavedPlacement {
            maximized,
            normal: (100, 80, 1380, 880),
        }
    }

    #[test]
    fn button_exit_is_always_normal() {
        assert!(!exit_show_maximized(&placement(true), ExitTarget::Normal));
        assert!(!exit_show_maximized(&placement(false), ExitTarget::Normal));
    }

    #[test]
    fn f11_exit_returns_to_previous_state() {
        assert!(exit_show_maximized(&placement(true), ExitTarget::Previous));
        assert!(!exit_show_maximized(&placement(false), ExitTarget::Previous));
    }

    #[test]
    fn busy_guard_rejects_overlap_and_releases() {
        let flag = Arc::new(AtomicBool::new(false));
        let first = BusyGuard::try_acquire(&flag).expect("first acquires");
        assert!(BusyGuard::try_acquire(&flag).is_none(), "overlap is a no-op");
        drop(first);
        assert!(BusyGuard::try_acquire(&flag).is_some(), "released after drop");
    }

    const WORK: PhysRect = (0, 0, 1920, 1032);
    const MON: PhysRect = (0, 0, 1920, 1080);

    #[test]
    fn legacy_signature_matches_the_real_saved_state() {
        // The installed v0.11.0's saved state on this machine.
        assert!(is_legacy_screen_sized(false, (-8, -8), (1920, 1032), &[WORK, MON]));
        // Saved during fullscreen: exactly the monitor.
        assert!(is_legacy_screen_sized(false, (0, 0), (1920, 1080), &[WORK, MON]));
        // Secondary monitor at negative coordinates.
        let work2: PhysRect = (-1600, 91, 1600, 852);
        assert!(is_legacy_screen_sized(false, (-1608, 83), (1600, 852), &[work2]));
    }

    #[test]
    fn legitimate_windows_are_kept() {
        // Maximized is a real state, never touched.
        assert!(!is_legacy_screen_sized(true, (-8, -8), (1920, 1032), &[WORK, MON]));
        // Close to the screen size, but not exact.
        assert!(!is_legacy_screen_sized(false, (-8, -8), (1910, 1032), &[WORK, MON]));
        assert!(!is_legacy_screen_sized(false, (-8, -8), (1920, 1020), &[WORK, MON]));
        // Exact size but placed elsewhere (dragged).
        assert!(!is_legacy_screen_sized(false, (40, 20), (1920, 1032), &[WORK, MON]));
        assert!(!is_legacy_screen_sized(false, (-30, -8), (1920, 1032), &[WORK, MON]));
        // An ordinary window.
        assert!(!is_legacy_screen_sized(false, (320, 140), (1280, 800), &[WORK, MON]));
        // No areas known.
        assert!(!is_legacy_screen_sized(false, (-8, -8), (1920, 1032), &[]));
    }

    #[test]
    fn repaired_rect_is_centered_default_and_clamped() {
        assert_eq!(repaired_normal_rect(WORK, 1.0), (320, 116, 1280, 800));
        // 150% scaling on a 4K work area.
        assert_eq!(repaired_normal_rect((0, 0, 3840, 2088), 1.5), (960, 444, 1920, 1200));
        // Small screen: 90% of the work area, not below the minimum.
        let (_, _, w, h) = repaired_normal_rect((0, 0, 1024, 720), 1.0);
        assert_eq!((w, h), (921, 648));
        // Secondary monitor at negative coordinates stays on that monitor.
        let (x, y, _, _) = repaired_normal_rect((-1600, 91, 1600, 852), 1.0);
        assert!(x >= -1600 && x < 0 && y >= 91);
    }
}
