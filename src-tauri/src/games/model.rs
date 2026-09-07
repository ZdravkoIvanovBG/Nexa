use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameEntry {
    pub id: String,
    pub title: String,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub platform: String,
    pub source_kind: String,
    pub exe_path: Option<String>,
    pub working_dir: Option<String>,
    pub launch_args: Option<String>,
    pub external_id: Option<String>,
    pub install_dir: Option<String>,
    pub cover_path: Option<String>,
    pub hero_path: Option<String>,
    pub logo_path: Option<String>,
    pub total_playtime_minutes: i64,
    pub last_played_at: Option<i64>,
    pub added_at: i64,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSession {
    pub id: String,
    pub game_id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub duration_sec: Option<i64>,
    pub launch_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Achievement {
    pub id: String,
    pub game_id: String,
    pub api_name: String,
    pub display_name: String,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub icon_gray_url: Option<String>,
    pub unlocked: bool,
    pub unlocked_at: Option<i64>,
    pub global_percent: Option<f64>,
    pub fetched_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherSource {
    pub id: String,
    pub enabled: bool,
    pub last_scan_at: Option<i64>,
    pub root_paths: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualGameInput {
    pub title: String,
    pub developer: Option<String>,
    pub exe_path: String,
    pub working_dir: Option<String>,
    pub launch_args: Option<String>,
    pub cover_source_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameUpdateInput {
    pub title: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub exe_path: Option<String>,
    pub working_dir: Option<String>,
    pub launch_args: Option<String>,
    pub hidden: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLibraryQuery {
    pub platform: Option<String>,
    pub search: Option<String>,
    pub sort: String,
}

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Lowercase, article-stripped sort key so "The Witcher 3" sorts under "W".
pub fn sort_title_for(title: &str) -> String {
    let lower = title.trim().to_lowercase();
    for article in ["the ", "a ", "an "] {
        if let Some(rest) = lower.strip_prefix(article) {
            return rest.to_string();
        }
    }
    lower
}
