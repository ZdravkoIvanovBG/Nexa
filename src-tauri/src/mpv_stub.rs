//! Mobile stand-in for [`crate::mpv`].
//!
//! `libmpv2-sys`'s build script emits an unconditional `cargo:rustc-link-lib=mpv`,
//! and this repo ships no Android/iOS build of libmpv, so `libmpv2` is a
//! desktop-only dependency (see `Cargo.toml`). Without this module the crate
//! fails to link for `aarch64-linux-android`.
//!
//! It mirrors the desktop module's command surface exactly, so `lib.rs` can keep
//! one `generate_handler![]` list and one `.manage(MpvState::new())` call for
//! every platform. The only command with real behaviour is [`mpv_probe`], which
//! reports `available: false`; the frontend's `pickBridge()` sees that and falls
//! through to the HTML5 bridge. The rest are therefore unreachable in practice
//! and return a descriptive error rather than panicking.

// Types here exist to mirror `mpv.rs`'s API shape. Their fields are populated by
// serde or never constructed at all, so the usual dead-code analysis misfires.
#![allow(dead_code)]

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

const UNSUPPORTED: &str = "libmpv is not available on this platform";

fn unsupported<T>() -> Result<T, String> {
    Err(UNSUPPORTED.to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MpvProbe {
    pub available: bool,
    pub binary: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MpvSub {
    pub url: String,
    pub lang: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvStartArgs {
    pub url: String,
    pub start_at_sec: Option<f64>,
    pub subtitles: Option<Vec<MpvSub>>,
    pub hdr_to_sdr: Option<bool>,
    pub rtx_hdr: Option<bool>,
    pub embed: Option<bool>,
    pub d3d11_flip: Option<bool>,
    pub mac_edr: Option<bool>,
    pub is_live: Option<bool>,
    pub headers: Option<HashMap<String, String>>,
    pub extra_options: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MpvGeometry {
    pub css_left: f64,
    pub css_top: f64,
    pub css_width: f64,
    pub css_height: f64,
    pub css_view_w: f64,
    pub css_view_h: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AudioDevice {
    pub name: String,
    pub description: String,
}

#[derive(Serialize)]
pub struct GifResult {
    path: String,
    frames: u32,
}

#[derive(Serialize)]
pub struct ClipResult {
    path: String,
    duration: f64,
}

/// Mirrors `mpv::MpvState` so `lib.rs`'s `.manage()` call is platform-agnostic.
/// There is no session to hold on mobile, so it carries no state.
pub struct MpvState;

impl MpvState {
    pub fn new() -> Self {
        Self
    }
}

#[tauri::command]
pub async fn mpv_probe(_app: AppHandle) -> MpvProbe {
    MpvProbe {
        available: false,
        binary: None,
        version: None,
        error: Some(UNSUPPORTED.to_string()),
    }
}

#[tauri::command]
pub async fn mpv_audio_devices(_state: State<'_, MpvState>) -> Result<Vec<AudioDevice>, String> {
    Ok(Vec::new())
}

#[tauri::command]
pub async fn mpv_start(
    _app: AppHandle,
    _state: State<'_, MpvState>,
    _args: MpvStartArgs,
) -> Result<(), String> {
    unsupported()
}

#[tauri::command]
pub async fn mpv_command(_state: State<'_, MpvState>, _cmd: Vec<Value>) -> Result<(), String> {
    unsupported()
}

#[tauri::command]
pub async fn mpv_set_property(
    _state: State<'_, MpvState>,
    _name: String,
    _value: Value,
) -> Result<(), String> {
    unsupported()
}

#[tauri::command]
pub async fn mpv_get_property(
    _state: State<'_, MpvState>,
    _name: String,
) -> Result<Value, String> {
    unsupported()
}

#[tauri::command]
pub async fn mpv_set_geometry(
    _app: AppHandle,
    _state: State<'_, MpvState>,
    _geom: MpvGeometry,
) -> Result<(), String> {
    // The HTML5 bridge lays itself out in the DOM; there is no native surface
    // to position, so this is a no-op rather than an error.
    Ok(())
}

#[tauri::command]
pub fn mpv_export_log(_app: AppHandle) -> Result<String, String> {
    unsupported()
}

#[tauri::command]
pub async fn mpv_force_below(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn mpv_set_hdr_stage(_app: AppHandle, _active: bool) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn display_hdr_active(_app: AppHandle) -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub async fn mpv_save_screenshot(
    _state: State<'_, MpvState>,
    _path: String,
) -> Result<String, String> {
    unsupported()
}

#[tauri::command]
pub async fn mpv_gif_start(_state: State<'_, MpvState>) -> Result<(), String> {
    unsupported()
}

#[tauri::command]
pub async fn mpv_gif_abort() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn mpv_gif_stop(_out_path: String) -> Result<GifResult, String> {
    unsupported()
}

#[tauri::command]
pub async fn mpv_clip_save(
    _state: State<'_, MpvState>,
    _with_subs: bool,
    _before_sec: f64,
    _out_path: String,
) -> Result<ClipResult, String> {
    unsupported()
}

#[tauri::command]
pub async fn mpv_screenshot_data_url(_state: State<'_, MpvState>) -> Result<String, String> {
    unsupported()
}

#[tauri::command]
pub async fn mpv_on_pip_changed(
    _app: AppHandle,
    _state: State<'_, MpvState>,
    _entering: bool,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn mpv_sub_add(
    _state: State<'_, MpvState>,
    _url: String,
    _lang: Option<String>,
    _title: Option<String>,
    _select: Option<bool>,
) -> Result<(), String> {
    unsupported()
}

// NOTE: the desktop `sub_download` is pure HTTP + subtitle conversion and does
// not touch libmpv; it only lives in `mpv.rs` for historical reasons. Stubbing
// it here disables subtitle downloads on mobile. Extracting it into its own
// module would restore the feature on both platforms — deliberately left out of
// this change to keep the desktop build byte-for-byte unchanged.
#[tauri::command]
pub async fn sub_download(
    _url: String,
    _format: Option<String>,
    _encoding: Option<String>,
    _lang: Option<String>,
) -> Result<String, String> {
    unsupported()
}

#[tauri::command]
pub async fn mpv_stop(_app: AppHandle, _state: State<'_, MpvState>) -> Result<(), String> {
    Ok(())
}
