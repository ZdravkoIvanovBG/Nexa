use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::model::GameEntry;
use super::store::GamesDbState;

pub fn steam_uri(app_id: &str) -> String {
    format!("steam://run/{app_id}")
}

/// Steam appids for known non-game utilities/redistributables that install
/// alongside real games and show up the same way in `libraryfolders.vdf`.
/// `steamlocate` parses `appmanifest_<id>.acf` files, which carry no "app
/// type" field (that lives in Steam's separate binary `appinfo.vdf` cache,
/// which we don't parse) — so filtering by id/name is the only option short
/// of adding a VDF-binary parser just for this.
const NON_GAME_APP_IDS: &[u32] = &[
    228980,  // Steamworks Common Redistributables
    431960,  // Wallpaper Engine
    250820,  // SteamVR
    1070560, // Steam Linux Runtime
    1391110, // Steam Linux Runtime - Soldier
    1493710, // Steam Linux Runtime - Sniper
    1628350, // Steam Linux Runtime - Steam Deck
    1161040, // Proton BattlEye Runtime
    1245040, // Proton EasyAntiCheat Runtime
];

/// Not exhaustive by id alone — Proton and the Steam Linux Runtime ship a new
/// appid with every release, so this pairs the hardcoded list above with a
/// name-based fallback for those specific, unlikely-to-collide-with-a-real-
/// game families.
pub(crate) fn is_non_game_app(app_id: u32, name: &str) -> bool {
    if NON_GAME_APP_IDS.contains(&app_id) {
        return true;
    }
    let lower = name.trim().to_lowercase();
    lower == "proton"
        || lower.starts_with("proton ")
        || lower.starts_with("steam linux runtime")
        || lower == "steamworks common redistributables"
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanProgressEvent {
    found: u32,
    total: Option<u32>,
    current_title: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanDoneEvent {
    games: Vec<GameEntry>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanErrorEvent {
    error: String,
}

#[tauri::command]
pub async fn games_steam_scan_start(
    app: AppHandle,
    db: State<'_, GamesDbState>,
) -> Result<String, String> {
    let scan_id = uuid::Uuid::new_v4().to_string();
    let conn = db.conn.clone();
    let app2 = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let result = run_steam_scan(&app2, &conn);
        match result {
            Ok(games) => {
                let _ = app2.emit("games://steam-scan-done", &ScanDoneEvent { games });
            }
            Err(e) => {
                let _ = app2.emit("games://steam-scan-error", &ScanErrorEvent { error: e });
            }
        }
    });

    Ok(scan_id)
}

fn run_steam_scan(
    app: &AppHandle,
    conn: &std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
) -> Result<Vec<GameEntry>, String> {
    let steam_dir = steamlocate::SteamDir::locate().map_err(|e| e.to_string())?;
    {
        let g = conn.lock().map_err(|e| e.to_string())?;
        purge_non_game_rows(&g).map_err(|e| e.to_string())?;
    }
    let apps: Vec<(u32, String, Option<String>)> = steam_dir
        .libraries()
        .map_err(|e| e.to_string())?
        .filter_map(|lib| lib.ok())
        .flat_map(|lib| {
            lib.apps()
                .filter_map(|app| app.ok())
                .map(|app| {
                    (
                        app.app_id,
                        app.name.clone().unwrap_or_else(|| format!("App {}", app.app_id)),
                        Some(app.install_dir.clone()),
                    )
                })
                .collect::<Vec<_>>()
        })
        .filter(|(app_id, name, _)| !is_non_game_app(*app_id, name))
        .collect();

    let total = apps.len() as u32;
    let mut out = Vec::with_capacity(apps.len());
    let g = conn.lock().map_err(|e| e.to_string())?;
    for (found, (app_id, name, install_dir)) in apps.into_iter().enumerate() {
        let _ = app.emit(
            "games://steam-scan-progress",
            &ScanProgressEvent {
                found: found as u32 + 1,
                total: Some(total),
                current_title: name.clone(),
            },
        );
        let external_id = app_id.to_string();
        let id = super::store::upsert_by_external_id(
            &g,
            "steam",
            "steam_uri",
            &external_id,
            &name,
            install_dir.as_deref(),
            Some(&super::artwork::steam_cover_url(&external_id)),
        )
        .map_err(|e| e.to_string())?;
        if let Some(entry) = super::store::game_by_id(&g, &id).map_err(|e| e.to_string())? {
            out.push(entry);
        }
    }
    Ok(out)
}

/// The scan filter below only stops *new* inserts, so anything a previous
/// build stored (Steamworks Common Redistributables, Wallpaper Engine, …)
/// has to be removed here — otherwise it stays in the library no matter how
/// many times the user rescans.
fn purge_non_game_rows(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    let stale: Vec<String> = super::store::scanned_rows(conn, "steam")?
        .into_iter()
        .filter(|(_, external_id, title)| {
            is_non_game_app(external_id.parse::<u32>().unwrap_or(0), title)
        })
        .map(|(id, _, _)| id)
        .collect();
    super::store::delete_games_by_id(conn, &stale)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_blacklisted_app_ids() {
        assert!(is_non_game_app(228980, "Steamworks Common Redistributables"));
        assert!(is_non_game_app(431960, "Wallpaper Engine"));
        assert!(is_non_game_app(1628350, "Steam Linux Runtime 3.0 (sniper)"));
    }

    #[test]
    fn rejects_runtime_families_by_name() {
        // Proton and the Linux runtimes ship a fresh appid per release, so the
        // name check has to hold for ids the list has never seen.
        assert!(is_non_game_app(9999999, "Proton 9.0"));
        assert!(is_non_game_app(9999998, "Steam Linux Runtime 4.0"));
    }

    #[test]
    fn keeps_real_games() {
        assert!(!is_non_game_app(620, "Portal 2"));
        assert!(!is_non_game_app(292030, "The Witcher 3: Wild Hunt"));
        // Guard the name check against swallowing a title that merely starts
        // with the same word.
        assert!(!is_non_game_app(123456, "Protonwar"));
    }
}
