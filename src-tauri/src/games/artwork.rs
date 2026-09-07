use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use super::store::GamesDbState;

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Harbor/games-artwork")
        .build()
        .unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtworkCandidate {
    pub source: String,
    pub url: String,
    pub kind: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

fn artwork_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    let target = dir.join("games-artwork");
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    Ok(target)
}

const STEAM_CDN_BASE: &str = "https://cdn.akamai.steamstatic.com/steam/apps";

const STEAM_CDN_CANDIDATES: &[(&str, &str, Option<u32>, Option<u32>)] = &[
    ("library_600x900.jpg", "cover", Some(600), Some(900)),
    ("library_hero.jpg", "hero", Some(1920), Some(620)),
    ("logo.png", "logo", None, None),
];

/// The portrait library capsule Steam serves for (almost) every appid — used
/// as a Steam game's default cover straight after a scan, with no API key and
/// no network round-trip during the scan itself.
pub(crate) fn steam_cover_url(app_id: &str) -> String {
    format!("{STEAM_CDN_BASE}/{app_id}/library_600x900.jpg")
}

/// Steam's public storefront CDN needs no API key and covers most PC titles by
/// appid, so it's always queried for Steam games. SteamGridDB is queried too
/// when the user has supplied a key (Settings > Games); RAWG support can be
/// added here later the same way.
#[tauri::command]
pub async fn games_artwork_search(
    game_title: String,
    platform_hint: Option<String>,
    external_id: Option<String>,
    steamgriddb_api_key: Option<String>,
) -> Result<Vec<ArtworkCandidate>, String> {
    let steam_app_id = if platform_hint.as_deref() == Some("steam") {
        external_id.as_deref()
    } else {
        None
    };

    let mut out = Vec::new();

    if let Some(app_id) = steam_app_id {
        out.extend(steam_cdn_candidates(app_id).await);
    }

    if let Some(key) = steamgriddb_api_key.filter(|k| !k.trim().is_empty()) {
        match sgdb_search(&key, &search_title(&game_title), steam_app_id).await {
            Ok(mut candidates) => out.append(&mut candidates),
            Err(e) => {
                eprintln!("[harbor::games::artwork] SteamGridDB search failed: {e}");
                // With nothing else to show, a rejected key or a network
                // failure has to reach the picker — otherwise it reads as
                // "no artwork exists for this game".
                if out.is_empty() {
                    return Err(e);
                }
            }
        }
    }

    Ok(out)
}

/// Launcher titles carry store decorations ("Rocket League®") that no
/// SteamGridDB entry has in its name.
fn search_title(title: &str) -> String {
    title
        .replace(['™', '®', '©'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Probes Steam's storefront CDN for the handful of well-known per-appid
/// asset paths (undocumented but stable, used by most third-party game
/// launchers) and only returns the ones that actually exist.
async fn steam_cdn_candidates(app_id: &str) -> Vec<ArtworkCandidate> {
    let c = client();
    let mut out = Vec::new();
    for (file, kind, width, height) in STEAM_CDN_CANDIDATES {
        let url = format!("{STEAM_CDN_BASE}/{app_id}/{file}");
        let exists = c
            .head(&url)
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        if exists {
            out.push(ArtworkCandidate {
                source: "steam_cdn".into(),
                url,
                kind: (*kind).into(),
                width: *width,
                height: *height,
            });
        }
    }
    out
}

fn sgdb_client(api_key: &str) -> Result<reqwest::Client, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    // Trimmed because a key pasted with a stray newline or space would
    // otherwise make `from_str` reject the whole header value.
    let value = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", api_key.trim()))
        .map_err(|_| "SteamGridDB API key contains invalid characters".to_string())?;
    headers.insert(reqwest::header::AUTHORIZATION, value);
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .default_headers(headers)
        .build()
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct SgdbEnvelope<T> {
    #[serde(default)]
    success: bool,
    // `Option<T>` fields are already treated as optional by serde (a missing
    // key deserializes to `None`) — no `#[serde(default)]` needed there,
    // which would otherwise force an unwanted `T: Default` bound on every
    // caller. `success` itself gets `#[serde(default)]` since a malformed or
    // truly empty body (`{}`) should read as "not successful", not fail to
    // parse outright.
    data: Option<T>,
    // SteamGridDB reports "Invalid authentication token" and friends here;
    // without surfacing it a bad key is indistinguishable from a game that
    // genuinely has no artwork.
    errors: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct SgdbGame {
    // Every field here is optional: SteamGridDB's schema isn't contractual,
    // and treating a missing/null field as absent-but-parseable (rather than
    // a hard decode error) is what actually fixes "error decoding response
    // body" — a single unexpectedly-null field used to fail the whole batch.
    id: Option<u32>,
}

#[derive(Deserialize)]
struct SgdbImage {
    url: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    #[allow(dead_code)]
    style: Option<String>,
    #[allow(dead_code)]
    notes: Option<String>,
    #[allow(dead_code)]
    author: Option<serde_json::Value>,
}

/// Fetches and parses one SteamGridDB endpoint. Reads the body as text first
/// and parses that explicitly (rather than `Response::json`) so a decode
/// failure reports the HTTP status and a snippet of the actual body instead
/// of reqwest's opaque "error decoding response body".
async fn sgdb_get<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    url: impl reqwest::IntoUrl,
) -> Result<SgdbEnvelope<T>, String> {
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let envelope = serde_json::from_str::<SgdbEnvelope<T>>(&text).map_err(|e| {
        let snippet: String = text.chars().take(200).collect();
        format!("SteamGridDB response (status {status}) failed to parse: {e} — body: {snippet}")
    })?;
    // A rejected key (401) or a rate limit (429) parses fine as an envelope,
    // so the status has to be checked separately or the caller reads it as an
    // empty result.
    if !status.is_success() {
        let detail = envelope
            .errors
            .as_ref()
            .filter(|e| !e.is_empty())
            .map(|e| e.join(", "))
            .unwrap_or_else(|| status.to_string());
        return Err(format!("SteamGridDB rejected the request: {detail}"));
    }
    Ok(envelope)
}

/// Builds the title-search url. The base carries no trailing slash on
/// purpose: `path_segments_mut().push()` always inserts its own separator, so
/// pushing onto ".../autocomplete/" yields ".../autocomplete//<title>", which
/// SteamGridDB answers with a 404 HTML page instead of JSON — that alone broke
/// every title-based search.
fn autocomplete_url(title: &str) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse("https://www.steamgriddb.com/api/v2/search/autocomplete")
        .map_err(|e| e.to_string())?;
    url.path_segments_mut()
        .map_err(|_| "invalid SteamGridDB search URL".to_string())?
        .push(title.trim());
    Ok(url)
}

/// Resolves a SteamGridDB internal game id: by Steam appid when we have one
/// (exact match), otherwise by a title search (best-effort, first hit wins).
async fn sgdb_game_id(
    client: &reqwest::Client,
    title: &str,
    steam_app_id: Option<&str>,
) -> Result<Option<u32>, String> {
    if let Some(app_id) = steam_app_id {
        let url = format!("https://www.steamgriddb.com/api/v2/games/steam/{app_id}");
        // A game SteamGridDB doesn't know by appid answers 404 — not a reason
        // to give up, since the title search below may still match it.
        match sgdb_get::<SgdbGame>(client, url).await {
            Ok(resp) if resp.success => {
                if let Some(id) = resp.data.and_then(|g| g.id) {
                    return Ok(Some(id));
                }
            }
            Ok(_) => {}
            Err(e) => eprintln!("[harbor::games::artwork] SteamGridDB appid lookup failed: {e}"),
        }
    }

    let resp = sgdb_get::<Vec<SgdbGame>>(client, autocomplete_url(title)?).await?;
    if !resp.success {
        return Ok(None);
    }
    Ok(resp
        .data
        .unwrap_or_default()
        .into_iter()
        .find_map(|g| g.id))
}

async fn sgdb_images(
    client: &reqwest::Client,
    endpoint: &str,
    game_id: u32,
    dimensions: Option<&str>,
) -> Result<Vec<SgdbImage>, String> {
    let mut url = format!("https://www.steamgriddb.com/api/v2/{endpoint}/game/{game_id}");
    if let Some(d) = dimensions {
        url.push_str("?dimensions=");
        url.push_str(d);
    }
    let resp = sgdb_get::<Vec<SgdbImage>>(client, url).await?;
    if !resp.success {
        return Ok(Vec::new());
    }
    Ok(resp.data.unwrap_or_default())
}

const SGDB_RESULT_CAP: usize = 24;

async fn sgdb_search(
    api_key: &str,
    title: &str,
    steam_app_id: Option<&str>,
) -> Result<Vec<ArtworkCandidate>, String> {
    let client = sgdb_client(api_key)?;
    let Some(game_id) = sgdb_game_id(&client, title, steam_app_id).await? else {
        return Ok(Vec::new());
    };

    let mut out = Vec::new();
    for (endpoint, dimensions, kind) in [
        ("grids", Some("600x900"), "cover"),
        ("heroes", None, "hero"),
        ("logos", None, "logo"),
    ] {
        match sgdb_images(&client, endpoint, game_id, dimensions).await {
            Ok(images) => out.extend(
                images
                    .into_iter()
                    // A result with no url is unusable — drop it rather than
                    // surfacing a broken candidate to the picker.
                    .filter_map(|g| {
                        let url = g.url?;
                        Some(ArtworkCandidate {
                            source: "steamgriddb".into(),
                            url,
                            kind: kind.into(),
                            width: g.width,
                            height: g.height,
                        })
                    })
                    .take(SGDB_RESULT_CAP),
            ),
            Err(e) => eprintln!("[harbor::games::artwork] SteamGridDB {endpoint} fetch failed: {e}"),
        }
    }

    Ok(out)
}

#[tauri::command]
pub async fn games_artwork_fetch(
    app: AppHandle,
    db: State<'_, GamesDbState>,
    game_id: String,
    kind: String,
    url: String,
) -> Result<String, String> {
    let bytes = client()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let ext = url
        .rsplit('.')
        .next()
        .filter(|e| e.len() <= 4 && !e.contains('/'))
        .unwrap_or("jpg");
    let dir = artwork_cache_dir(&app)?;
    let hash = format!("{:x}", cache_key_hash(&url));
    let dest = dir.join(format!("{kind}-{hash}.{ext}"));
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    let path = dest.to_string_lossy().to_string();

    let conn = db.conn.clone();
    let path_for_db = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let g = conn.lock().map_err(|e| e.to_string())?;
        super::store::set_artwork_path(&g, &game_id, &kind, &path_for_db).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(path)
}

#[tauri::command]
pub async fn games_artwork_upload(
    app: AppHandle,
    db: State<'_, GamesDbState>,
    game_id: String,
    kind: String,
    source_path: String,
) -> Result<String, String> {
    let dir = super::store::games_dir(&app)?.join("covers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let src = PathBuf::from(&source_path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let dest = dir.join(format!("{game_id}-{kind}.{ext}"));
    std::fs::copy(&src, &dest).map_err(|e| format!("copy artwork: {e}"))?;
    let path = dest.to_string_lossy().to_string();

    let conn = db.conn.clone();
    let path_for_db = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let g = conn.lock().map_err(|e| e.to_string())?;
        super::store::set_artwork_path(&g, &game_id, &kind, &path_for_db).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(path)
}

/// Cheap, dependency-free hash for cache filenames — collisions are harmless
/// here since a re-fetch just overwrites the same file.
fn cache_key_hash(input: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autocomplete_url_has_exactly_one_separator() {
        let url = autocomplete_url("Fortnite").unwrap();
        assert_eq!(
            url.as_str(),
            "https://www.steamgriddb.com/api/v2/search/autocomplete/Fortnite"
        );
    }

    #[test]
    fn autocomplete_url_encodes_the_title() {
        let url = autocomplete_url(" Rocket League / Sideswipe ").unwrap();
        assert!(
            url.path().ends_with("/autocomplete/Rocket%20League%20%2F%20Sideswipe"),
            "unexpected path: {}",
            url.path()
        );
    }

    #[test]
    fn search_title_drops_store_decorations() {
        assert_eq!(search_title("Rocket League®"), "Rocket League");
        assert_eq!(search_title("LEGO® Fortnite™"), "LEGO Fortnite");
        assert_eq!(search_title("Half-Life 2"), "Half-Life 2");
    }

    #[test]
    fn steam_cover_url_points_at_the_portrait_capsule() {
        assert_eq!(
            steam_cover_url("620"),
            "https://cdn.akamai.steamstatic.com/steam/apps/620/library_600x900.jpg"
        );
    }
}
