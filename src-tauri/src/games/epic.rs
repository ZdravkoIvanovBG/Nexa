use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use super::model::GameEntry;
use super::store::GamesDbState;

#[derive(Deserialize)]
struct EpicManifest {
    #[serde(rename = "AppName")]
    app_name: String,
    #[serde(rename = "DisplayName")]
    display_name: String,
    #[serde(rename = "InstallLocation")]
    install_location: Option<String>,
    #[serde(rename = "CatalogNamespace")]
    catalog_namespace: Option<String>,
    #[serde(rename = "CatalogItemId")]
    catalog_item_id: Option<String>,
    #[serde(rename = "MainGameAppName")]
    main_game_app_name: Option<String>,
    #[serde(rename = "MainGameAppStoreId")]
    main_game_app_store_id: Option<String>,
    #[serde(rename = "AppCategories", default)]
    app_categories: Vec<String>,
    #[serde(rename = "bIsApplication")]
    is_application: Option<bool>,
    #[serde(rename = "LaunchExecutable")]
    launch_executable: Option<String>,
}

/// Epic writes a `.item` manifest for DLC and add-on content the same way it
/// does for a base game — "LEGO® Fortnite Content" even shares Fortnite's
/// install location. Add-ons are distinguished by carrying
/// `"bIsApplication": false`, no launch executable, and categories that hold
/// neither "games" nor "applications" (real DLC additionally names its base
/// game). Any one of those is enough to skip the entry.
fn is_addon(manifest: &EpicManifest) -> bool {
    if manifest.is_application == Some(false) {
        return true;
    }
    if manifest
        .main_game_app_name
        .as_deref()
        .is_some_and(|v| !v.trim().is_empty() && v != manifest.app_name)
    {
        return true;
    }
    if manifest
        .main_game_app_store_id
        .as_deref()
        .is_some_and(|v| !v.trim().is_empty())
    {
        return true;
    }
    if manifest
        .launch_executable
        .as_deref()
        .is_some_and(|v| v.trim().is_empty())
    {
        return true;
    }
    !manifest.app_categories.is_empty()
        && !manifest.app_categories.iter().any(|c| {
            let c = c.trim().to_ascii_lowercase();
            c == "games" || c == "applications"
        })
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

fn launcher_data_dir() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        let program_data = std::env::var_os("ProgramData")?;
        return Some(
            std::path::PathBuf::from(program_data)
                .join("Epic")
                .join("EpicGamesLauncher")
                .join("Data"),
        );
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn manifests_dir() -> Option<std::path::PathBuf> {
    Some(launcher_data_dir()?.join("Manifests"))
}

#[derive(Deserialize)]
struct CatalogEntry {
    namespace: Option<String>,
    id: Option<String>,
    #[serde(rename = "keyImages", default)]
    key_images: Vec<CatalogImage>,
}

#[derive(Deserialize)]
struct CatalogImage {
    #[serde(rename = "type")]
    kind: Option<String>,
    url: Option<String>,
}

/// Portrait art first — the library grid renders 2:3 cards — then the
/// landscape box art as a last resort so a card is never left blank.
const COVER_IMAGE_PRIORITY: &[&str] = &[
    "DieselGameBoxTall",
    "OfferImageTall",
    "Thumbnail",
    "DieselGameBox",
];

/// Epic manifests carry no artwork at all, but the launcher caches the
/// storefront catalog (cover art URLs included) in `catcache.bin`: one
/// base64-encoded JSON array, keyed by catalog namespace + item id. A missing
/// or unreadable cache just means no automatic covers, never a failed scan.
fn catalog_covers() -> std::collections::HashMap<(String, String), String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let mut out = std::collections::HashMap::new();
    let Some(path) = launcher_data_dir().map(|d| d.join("Catalog").join("catcache.bin")) else {
        return out;
    };
    let Ok(raw) = std::fs::read(&path) else {
        return out;
    };
    let Ok(decoded) = B64.decode(raw.trim_ascii()) else {
        return out;
    };
    let Ok(entries) = serde_json::from_slice::<Vec<CatalogEntry>>(&decoded) else {
        return out;
    };
    for entry in entries {
        let (Some(namespace), Some(id)) = (entry.namespace, entry.id) else {
            continue;
        };
        let cover = COVER_IMAGE_PRIORITY.iter().find_map(|wanted| {
            entry
                .key_images
                .iter()
                .find(|img| img.kind.as_deref() == Some(*wanted))
                .and_then(|img| img.url.clone())
                .filter(|url| !url.trim().is_empty())
        });
        if let Some(cover) = cover {
            out.insert((namespace, id), cover);
        }
    }
    out
}

#[tauri::command]
pub async fn games_epic_scan_start(
    app: AppHandle,
    db: State<'_, GamesDbState>,
) -> Result<String, String> {
    let scan_id = uuid::Uuid::new_v4().to_string();
    let conn = db.conn.clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || match run_epic_scan(&app2, &conn) {
        Ok(games) => {
            let _ = app2.emit("games://epic-scan-done", &ScanDoneEvent { games });
        }
        Err(e) => {
            let _ = app2.emit("games://epic-scan-error", &ScanErrorEvent { error: e });
        }
    });
    Ok(scan_id)
}

fn run_epic_scan(
    app: &AppHandle,
    conn: &std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
) -> Result<Vec<GameEntry>, String> {
    let Some(dir) = manifests_dir() else {
        return Err("Epic Games manifests are only supported on Windows".into());
    };
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("item"))
        .collect();

    let manifests: Vec<EpicManifest> = entries
        .into_iter()
        .filter_map(|entry| std::fs::read_to_string(entry.path()).ok())
        .filter_map(|raw| serde_json::from_str::<EpicManifest>(&raw).ok())
        .collect();

    let (games, addons): (Vec<_>, Vec<_>) = manifests.into_iter().partition(|m| !is_addon(m));
    let covers = catalog_covers();

    let total = games.len() as u32;
    let mut out = Vec::new();
    let g = conn.lock().map_err(|e| e.to_string())?;

    // Same reasoning as the Steam scanner: filtering new inserts is not enough
    // on its own, since add-ons stored by an earlier build would otherwise
    // stay in the library across every rescan.
    let stale: Vec<String> = {
        let addon_ids: std::collections::HashSet<&str> =
            addons.iter().map(|m| m.app_name.as_str()).collect();
        super::store::scanned_rows(&g, "epic")
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|(_, external_id, _)| addon_ids.contains(external_id.as_str()))
            .map(|(id, _, _)| id)
            .collect()
    };
    super::store::delete_games_by_id(&g, &stale).map_err(|e| e.to_string())?;

    for (found, manifest) in games.into_iter().enumerate() {
        let _ = app.emit(
            "games://epic-scan-progress",
            &ScanProgressEvent {
                found: found as u32 + 1,
                total: Some(total),
                current_title: manifest.display_name.clone(),
            },
        );
        let cover = manifest
            .catalog_namespace
            .as_ref()
            .zip(manifest.catalog_item_id.as_ref())
            .and_then(|(ns, item)| covers.get(&(ns.clone(), item.clone())));
        let id = super::store::upsert_by_external_id(
            &g,
            "epic",
            "epic_uri",
            &manifest.app_name,
            &manifest.display_name,
            manifest.install_location.as_deref(),
            cover.map(|c| c.as_str()),
        )
        .map_err(|e| e.to_string())?;
        if let Some(game) = super::store::game_by_id(&g, &id).map_err(|e| e.to_string())? {
            out.push(game);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Field shapes taken from real `.item` manifests written by the Epic
    /// Games Launcher.
    fn manifest(json: &str) -> EpicManifest {
        serde_json::from_str(json).expect("manifest should parse")
    }

    #[test]
    fn keeps_a_base_game() {
        let m = manifest(
            r#"{
                "AppName": "Fortnite",
                "DisplayName": "Fortnite",
                "InstallLocation": "E:/Program Files/Fortnite",
                "MainGameAppName": "",
                "AppCategories": ["games", "applications"],
                "bIsApplication": true,
                "LaunchExecutable": "FortniteGame/Binaries/Win64/FortniteBootstrapper.exe"
            }"#,
        );
        assert!(!is_addon(&m));
    }

    #[test]
    fn skips_dlc_content() {
        let m = manifest(
            r#"{
                "AppName": "94bc5ec13f8f438c97fdbef3e9019e27",
                "DisplayName": "LEGO\u00ae Fortnite Content",
                "InstallLocation": "E:/Program Files/Fortnite",
                "MainGameAppName": "",
                "AppCategories": ["hidden"],
                "bIsApplication": false,
                "LaunchExecutable": ""
            }"#,
        );
        assert!(is_addon(&m));
    }

    #[test]
    fn skips_dlc_naming_its_base_game() {
        let m = manifest(
            r#"{
                "AppName": "SomeDlc",
                "DisplayName": "Some DLC",
                "MainGameAppName": "SomeBaseGame",
                "AppCategories": ["games", "applications"],
                "bIsApplication": true,
                "LaunchExecutable": "Game.exe"
            }"#,
        );
        assert!(is_addon(&m));
    }

    #[test]
    fn skips_entries_carrying_a_main_game_store_id() {
        let m = manifest(
            r#"{
                "AppName": "SomeAddon",
                "DisplayName": "Some Add-on",
                "MainGameAppStoreId": "1234",
                "AppCategories": ["games", "applications"],
                "bIsApplication": true,
                "LaunchExecutable": "Game.exe"
            }"#,
        );
        assert!(is_addon(&m));
    }

    #[test]
    fn keeps_a_manifest_missing_the_optional_fields() {
        let m = manifest(r#"{ "AppName": "Sugar", "DisplayName": "Rocket League" }"#);
        assert!(!is_addon(&m));
    }
}
