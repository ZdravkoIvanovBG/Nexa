use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, State};

use super::model::{now_ms, Achievement};
use super::store::GamesDbState;

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default()
}

#[tauri::command]
pub async fn games_steam_verify_key(steam_api_key: String, steam_id64: String) -> Result<bool, String> {
    let url = format!(
        "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={}&steamids={}",
        steam_api_key, steam_id64
    );
    let resp = client().get(&url).send().await.map_err(|e| e.to_string())?;
    Ok(resp.status().is_success())
}

#[derive(Deserialize)]
struct SchemaResponse {
    game: SchemaGame,
}
#[derive(Deserialize)]
struct SchemaGame {
    #[serde(rename = "availableGameStats")]
    available_game_stats: Option<AvailableGameStats>,
}
#[derive(Deserialize)]
struct AvailableGameStats {
    achievements: Option<Vec<SchemaAchievement>>,
}
#[derive(Deserialize)]
struct SchemaAchievement {
    name: String,
    #[serde(rename = "displayName")]
    display_name: String,
    description: Option<String>,
    icon: Option<String>,
    #[serde(rename = "icongray")]
    icon_gray: Option<String>,
}

#[derive(Deserialize)]
struct PlayerAchievementsResponse {
    playerstats: PlayerStats,
}
#[derive(Deserialize)]
struct PlayerStats {
    achievements: Option<Vec<PlayerAchievement>>,
    success: bool,
}
#[derive(Deserialize)]
struct PlayerAchievement {
    apiname: String,
    achieved: i32,
    unlocktime: i64,
}

#[derive(Deserialize)]
struct GlobalPercentResponse {
    achievementpercentages: GlobalPercentInner,
}
#[derive(Deserialize)]
struct GlobalPercentInner {
    achievements: Vec<GlobalPercentEntry>,
}
#[derive(Deserialize)]
struct GlobalPercentEntry {
    name: String,
    percent: f64,
}

#[tauri::command]
pub async fn games_achievements_fetch(
    app: AppHandle,
    db: State<'_, GamesDbState>,
    game_id: String,
    steam_api_key: String,
    steam_id64: String,
) -> Result<Vec<Achievement>, String> {
    let _ = &app;
    let conn = db.conn.clone();
    let game_id_for_lookup = game_id.clone();
    let entry = tauri::async_runtime::spawn_blocking(move || {
        let g = conn.lock().map_err(|e| e.to_string())?;
        super::store::game_by_id(&g, &game_id_for_lookup)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "game not found".to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    if entry.platform != "steam" {
        return Err("achievements are only available for Steam games".into());
    }
    let app_id = entry
        .external_id
        .clone()
        .ok_or_else(|| "game has no Steam app id".to_string())?;

    let c = client();

    let schema_url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key={steam_api_key}&appid={app_id}"
    );
    let schema: SchemaResponse = c
        .get(&schema_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| format!("parse schema: {e}"))?;
    let schema_achievements = schema
        .game
        .available_game_stats
        .and_then(|s| s.achievements)
        .unwrap_or_default();

    let player_url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?key={steam_api_key}&steamid={steam_id64}&appid={app_id}"
    );
    let player: PlayerAchievementsResponse = c
        .get(&player_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| format!("parse player achievements: {e}"))?;
    if !player.playerstats.success {
        return Err("Steam rejected the achievement request — check the API key and SteamID64".into());
    }
    let player_achievements = player.playerstats.achievements.unwrap_or_default();

    let percent_url = format!(
        "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid={app_id}"
    );
    let percents: GlobalPercentResponse = c
        .get(&percent_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .unwrap_or(GlobalPercentResponse {
            achievementpercentages: GlobalPercentInner {
                achievements: Vec::new(),
            },
        });

    let now = now_ms();
    let mut out = Vec::with_capacity(schema_achievements.len());
    for schema_a in &schema_achievements {
        let player_a = player_achievements.iter().find(|p| p.apiname == schema_a.name);
        let global_percent = percents
            .achievementpercentages
            .achievements
            .iter()
            .find(|p| p.name == schema_a.name)
            .map(|p| p.percent);
        out.push(Achievement {
            id: format!("{game_id}:{}", schema_a.name),
            game_id: game_id.clone(),
            api_name: schema_a.name.clone(),
            display_name: schema_a.display_name.clone(),
            description: schema_a.description.clone(),
            icon_url: schema_a.icon.clone(),
            icon_gray_url: schema_a.icon_gray.clone(),
            unlocked: player_a.map(|p| p.achieved != 0).unwrap_or(false),
            unlocked_at: player_a
                .filter(|p| p.achieved != 0 && p.unlocktime > 0)
                .map(|p| p.unlocktime * 1000),
            global_percent,
            fetched_at: now,
        });
    }

    let conn = db.conn.clone();
    let out_for_db = out.clone();
    let game_id_for_db = game_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let g = conn.lock().map_err(|e| e.to_string())?;
        super::store::upsert_achievements(&g, &game_id_for_db, &out_for_db).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(out)
}
