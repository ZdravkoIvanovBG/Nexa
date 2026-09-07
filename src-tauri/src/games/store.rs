use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension, Row};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use super::model::{
    now_ms, sort_title_for, Achievement, GameEntry, GameLibraryQuery, GameSession,
    GameUpdateInput, ManualGameInput,
};

pub struct GamesDbState {
    pub(crate) conn: Arc<Mutex<Connection>>,
}

impl GamesDbState {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let dir = games_dir(app)?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(dir.join("covers")).map_err(|e| e.to_string())?;
        let conn = Connection::open(dir.join("games.db")).map_err(|e| e.to_string())?;
        ensure_schema(&conn).map_err(|e| e.to_string())?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }
}

pub fn games_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("games"))
}

fn ensure_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

        CREATE TABLE IF NOT EXISTS games (
          id                      TEXT PRIMARY KEY,
          title                   TEXT NOT NULL,
          developer               TEXT,
          publisher               TEXT,
          platform                TEXT NOT NULL,
          source_kind             TEXT NOT NULL,
          exe_path                TEXT,
          working_dir             TEXT,
          launch_args             TEXT,
          external_id             TEXT,
          install_dir             TEXT,
          cover_path              TEXT,
          hero_path               TEXT,
          logo_path               TEXT,
          total_playtime_minutes  INTEGER NOT NULL DEFAULT 0,
          last_played_at          INTEGER,
          added_at                INTEGER NOT NULL,
          hidden                  INTEGER NOT NULL DEFAULT 0,
          sort_title              TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_games_platform ON games(platform);
        CREATE INDEX IF NOT EXISTS idx_games_last_played ON games(last_played_at DESC);
        CREATE INDEX IF NOT EXISTS idx_games_playtime ON games(total_playtime_minutes DESC);
        CREATE INDEX IF NOT EXISTS idx_games_sort_title ON games(sort_title);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_games_platform_external
          ON games(platform, external_id) WHERE external_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS game_sessions (
          id           TEXT PRIMARY KEY,
          game_id      TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          started_at   INTEGER NOT NULL,
          ended_at     INTEGER,
          duration_sec INTEGER,
          launch_kind  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_game ON game_sessions(game_id, started_at DESC);

        CREATE TABLE IF NOT EXISTS achievements (
          id             TEXT PRIMARY KEY,
          game_id        TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          api_name       TEXT NOT NULL,
          display_name   TEXT NOT NULL,
          description    TEXT,
          icon_url       TEXT,
          icon_gray_url  TEXT,
          unlocked       INTEGER NOT NULL DEFAULT 0,
          unlocked_at    INTEGER,
          global_percent REAL,
          fetched_at     INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_achievements_game ON achievements(game_id);

        CREATE TABLE IF NOT EXISTS launcher_sources (
          id           TEXT PRIMARY KEY,
          enabled      INTEGER NOT NULL DEFAULT 1,
          last_scan_at INTEGER,
          root_paths   TEXT
        );
        "#,
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('schema_version', '1')",
        [],
    )?;
    Ok(())
}

fn row_to_game(row: &Row) -> rusqlite::Result<GameEntry> {
    Ok(GameEntry {
        id: row.get("id")?,
        title: row.get("title")?,
        developer: row.get("developer")?,
        publisher: row.get("publisher")?,
        platform: row.get("platform")?,
        source_kind: row.get("source_kind")?,
        exe_path: row.get("exe_path")?,
        working_dir: row.get("working_dir")?,
        launch_args: row.get("launch_args")?,
        external_id: row.get("external_id")?,
        install_dir: row.get("install_dir")?,
        cover_path: row.get("cover_path")?,
        hero_path: row.get("hero_path")?,
        logo_path: row.get("logo_path")?,
        total_playtime_minutes: row.get("total_playtime_minutes")?,
        last_played_at: row.get("last_played_at")?,
        added_at: row.get("added_at")?,
        hidden: row.get::<_, i64>("hidden")? != 0,
    })
}

fn row_to_session(row: &Row) -> rusqlite::Result<GameSession> {
    Ok(GameSession {
        id: row.get("id")?,
        game_id: row.get("game_id")?,
        started_at: row.get("started_at")?,
        ended_at: row.get("ended_at")?,
        duration_sec: row.get("duration_sec")?,
        launch_kind: row.get("launch_kind")?,
    })
}

fn row_to_achievement(row: &Row) -> rusqlite::Result<Achievement> {
    Ok(Achievement {
        id: row.get("id")?,
        game_id: row.get("game_id")?,
        api_name: row.get("api_name")?,
        display_name: row.get("display_name")?,
        description: row.get("description")?,
        icon_url: row.get("icon_url")?,
        icon_gray_url: row.get("icon_gray_url")?,
        unlocked: row.get::<_, i64>("unlocked")? != 0,
        unlocked_at: row.get("unlocked_at")?,
        global_percent: row.get("global_percent")?,
        fetched_at: row.get("fetched_at")?,
    })
}

const GAME_COLUMNS: &str = "id, title, developer, publisher, platform, source_kind, exe_path, \
    working_dir, launch_args, external_id, install_dir, cover_path, hero_path, logo_path, \
    total_playtime_minutes, last_played_at, added_at, hidden";

#[tauri::command]
pub async fn games_add_manual(
    app: AppHandle,
    db: State<'_, GamesDbState>,
    input: ManualGameInput,
) -> Result<GameEntry, String> {
    let conn = db.conn.clone();
    let app_for_cover = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let id = Uuid::new_v4().to_string();
        let cover_path = match &input.cover_source_path {
            Some(src) => Some(copy_cover_in(&app_for_cover, &id, src)?),
            None => None,
        };
        let now = now_ms();
        let entry = GameEntry {
            id,
            title: input.title.clone(),
            developer: input.developer.clone(),
            publisher: None,
            platform: "custom".into(),
            source_kind: "direct_exe".into(),
            exe_path: Some(input.exe_path.clone()),
            working_dir: input.working_dir.clone(),
            launch_args: input.launch_args.clone(),
            external_id: None,
            install_dir: input.working_dir.clone(),
            cover_path,
            hero_path: None,
            logo_path: None,
            total_playtime_minutes: 0,
            last_played_at: None,
            added_at: now,
            hidden: false,
        };
        let g = conn.lock().map_err(|e| e.to_string())?;
        g.execute(
            &format!("INSERT INTO games ({GAME_COLUMNS}, sort_title) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)"),
            params![
                entry.id,
                entry.title,
                entry.developer,
                entry.publisher,
                entry.platform,
                entry.source_kind,
                entry.exe_path,
                entry.working_dir,
                entry.launch_args,
                entry.external_id,
                entry.install_dir,
                entry.cover_path,
                entry.hero_path,
                entry.logo_path,
                entry.total_playtime_minutes,
                entry.last_played_at,
                entry.added_at,
                entry.hidden as i64,
                sort_title_for(&entry.title),
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(entry)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn copy_cover_in(app: &AppHandle, game_id: &str, source_path: &str) -> Result<String, String> {
    let dir = games_dir(app)?.join("covers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let src = PathBuf::from(source_path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let dest = dir.join(format!("{game_id}.{ext}"));
    std::fs::copy(&src, &dest).map_err(|e| format!("copy cover: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn games_library_list(
    db: State<'_, GamesDbState>,
    query: GameLibraryQuery,
) -> Result<Vec<GameEntry>, String> {
    let conn = db.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let g = conn.lock().map_err(|e| e.to_string())?;
        let order_by = match query.sort.as_str() {
            "playtime" => "total_playtime_minutes DESC, sort_title ASC",
            "alpha" => "sort_title ASC",
            _ => "last_played_at IS NULL, last_played_at DESC, sort_title ASC",
        };
        let mut sql = format!("SELECT {GAME_COLUMNS} FROM games WHERE hidden = 0");
        let mut binds: Vec<String> = Vec::new();
        if let Some(platform) = query.platform.as_deref() {
            if platform != "all" {
                sql.push_str(" AND platform = ?");
                binds.push(platform.to_string());
            }
        }
        if let Some(search) = query.search.as_deref() {
            let trimmed = search.trim();
            if !trimmed.is_empty() {
                sql.push_str(" AND (title LIKE ? OR developer LIKE ?)");
                let pat = format!("%{trimmed}%");
                binds.push(pat.clone());
                binds.push(pat);
            }
        }
        sql.push_str(&format!(" ORDER BY {order_by}"));
        let mut stmt = g.prepare(&sql).map_err(|e| e.to_string())?;
        let params: Vec<&dyn rusqlite::ToSql> =
            binds.iter().map(|b| b as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query_map(params.as_slice(), row_to_game)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn games_get(db: State<'_, GamesDbState>, id: String) -> Result<GameEntry, String> {
    let conn = db.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let g = conn.lock().map_err(|e| e.to_string())?;
        g.query_row(
            &format!("SELECT {GAME_COLUMNS} FROM games WHERE id = ?1"),
            params![id],
            row_to_game,
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "game not found".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn games_update(
    db: State<'_, GamesDbState>,
    id: String,
    patch: GameUpdateInput,
) -> Result<GameEntry, String> {
    let conn = db.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let g = conn.lock().map_err(|e| e.to_string())?;
        if let Some(title) = &patch.title {
            g.execute(
                "UPDATE games SET title = ?1, sort_title = ?2 WHERE id = ?3",
                params![title, sort_title_for(title), id],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(developer) = &patch.developer {
            g.execute(
                "UPDATE games SET developer = ?1 WHERE id = ?2",
                params![developer, id],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(publisher) = &patch.publisher {
            g.execute(
                "UPDATE games SET publisher = ?1 WHERE id = ?2",
                params![publisher, id],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(exe_path) = &patch.exe_path {
            g.execute(
                "UPDATE games SET exe_path = ?1 WHERE id = ?2",
                params![exe_path, id],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(working_dir) = &patch.working_dir {
            g.execute(
                "UPDATE games SET working_dir = ?1 WHERE id = ?2",
                params![working_dir, id],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(launch_args) = &patch.launch_args {
            g.execute(
                "UPDATE games SET launch_args = ?1 WHERE id = ?2",
                params![launch_args, id],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(hidden) = patch.hidden {
            g.execute(
                "UPDATE games SET hidden = ?1 WHERE id = ?2",
                params![hidden as i64, id],
            )
            .map_err(|e| e.to_string())?;
        }
        g.query_row(
            &format!("SELECT {GAME_COLUMNS} FROM games WHERE id = ?1"),
            params![id],
            row_to_game,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn games_delete(db: State<'_, GamesDbState>, id: String) -> Result<(), String> {
    let conn = db.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let g = conn.lock().map_err(|e| e.to_string())?;
        g.execute("DELETE FROM games WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn games_sessions_list(
    db: State<'_, GamesDbState>,
    game_id: String,
) -> Result<Vec<GameSession>, String> {
    let conn = db.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let g = conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = g
            .prepare(
                "SELECT id, game_id, started_at, ended_at, duration_sec, launch_kind \
                 FROM game_sessions WHERE game_id = ?1 ORDER BY started_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![game_id], row_to_session)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn games_achievements_list(
    db: State<'_, GamesDbState>,
    game_id: String,
) -> Result<Vec<Achievement>, String> {
    let conn = db.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let g = conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = g
            .prepare(
                "SELECT id, game_id, api_name, display_name, description, icon_url, \
                 icon_gray_url, unlocked, unlocked_at, global_percent, fetched_at \
                 FROM achievements WHERE game_id = ?1 ORDER BY unlocked DESC, display_name ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![game_id], row_to_achievement)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Upsert a game by (platform, external_id) — used by the Steam/Epic scanners.
/// Returns the row id (existing or newly generated).
///
/// `default_cover_url` is the launcher's own cover art, applied with COALESCE
/// so a rescan backfills blank rows without ever overwriting artwork the user
/// picked or uploaded themselves.
pub(crate) fn upsert_by_external_id(
    conn: &Connection,
    platform: &str,
    source_kind: &str,
    external_id: &str,
    title: &str,
    install_dir: Option<&str>,
    default_cover_url: Option<&str>,
) -> rusqlite::Result<String> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM games WHERE platform = ?1 AND external_id = ?2",
            params![platform, external_id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = existing {
        conn.execute(
            "UPDATE games SET title = ?1, sort_title = ?2, install_dir = ?3, \
             cover_path = COALESCE(cover_path, ?4) WHERE id = ?5",
            params![
                title,
                sort_title_for(title),
                install_dir,
                default_cover_url,
                id
            ],
        )?;
        return Ok(id);
    }
    let id = Uuid::new_v4().to_string();
    conn.execute(
        &format!(
            "INSERT INTO games ({GAME_COLUMNS}, sort_title) VALUES \
             (?1,?2,NULL,NULL,?3,?4,NULL,NULL,NULL,?5,?6,?7,NULL,NULL,0,NULL,?8,0,?9)"
        ),
        params![
            id,
            title,
            platform,
            source_kind,
            external_id,
            install_dir,
            default_cover_url,
            now_ms(),
            sort_title_for(title),
        ],
    )?;
    Ok(id)
}

/// Every row a launcher scan has written for `platform`, as
/// (id, external_id, title).
pub(crate) fn scanned_rows(
    conn: &Connection,
    platform: &str,
) -> rusqlite::Result<Vec<(String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, external_id, title FROM games \
         WHERE platform = ?1 AND external_id IS NOT NULL",
    )?;
    let rows = stmt.query_map(params![platform], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    rows.collect()
}

/// Drops rows a scanner has since decided are not games (redistributables,
/// runtimes, DLC). Scans are purely additive, so without this an entry
/// inserted before a filter existed would stay in the library forever.
pub(crate) fn delete_games_by_id(conn: &Connection, ids: &[String]) -> rusqlite::Result<()> {
    for id in ids {
        conn.execute("DELETE FROM game_sessions WHERE game_id = ?1", params![id])?;
        conn.execute("DELETE FROM achievements WHERE game_id = ?1", params![id])?;
        conn.execute("DELETE FROM games WHERE id = ?1", params![id])?;
    }
    Ok(())
}

pub(crate) fn game_by_id(conn: &Connection, id: &str) -> rusqlite::Result<Option<GameEntry>> {
    conn.query_row(
        &format!("SELECT {GAME_COLUMNS} FROM games WHERE id = ?1"),
        params![id],
        row_to_game,
    )
    .optional()
}

pub(crate) fn record_session_end(
    conn: &Connection,
    game_id: &str,
    started_at: i64,
    ended_at: i64,
    duration_sec: i64,
    launch_kind: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO game_sessions (id, game_id, started_at, ended_at, duration_sec, launch_kind) \
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            Uuid::new_v4().to_string(),
            game_id,
            started_at,
            ended_at,
            duration_sec,
            launch_kind,
        ],
    )?;
    let minutes_delta = duration_sec / 60;
    conn.execute(
        "UPDATE games SET total_playtime_minutes = total_playtime_minutes + ?1, \
         last_played_at = ?2 WHERE id = ?3",
        params![minutes_delta, ended_at, game_id],
    )?;
    Ok(())
}

pub(crate) fn upsert_achievements(
    conn: &Connection,
    game_id: &str,
    achievements: &[Achievement],
) -> rusqlite::Result<()> {
    for a in achievements {
        conn.execute(
            "INSERT INTO achievements (id, game_id, api_name, display_name, description, \
             icon_url, icon_gray_url, unlocked, unlocked_at, global_percent, fetched_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) \
             ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, \
             description=excluded.description, icon_url=excluded.icon_url, \
             icon_gray_url=excluded.icon_gray_url, unlocked=excluded.unlocked, \
             unlocked_at=excluded.unlocked_at, global_percent=excluded.global_percent, \
             fetched_at=excluded.fetched_at",
            params![
                a.id,
                game_id,
                a.api_name,
                a.display_name,
                a.description,
                a.icon_url,
                a.icon_gray_url,
                a.unlocked as i64,
                a.unlocked_at,
                a.global_percent,
                a.fetched_at,
            ],
        )?;
    }
    Ok(())
}

pub(crate) fn set_artwork_path(
    conn: &Connection,
    game_id: &str,
    kind: &str,
    path: &str,
) -> rusqlite::Result<()> {
    let column = match kind {
        "hero" => "hero_path",
        "logo" => "logo_path",
        _ => "cover_path",
    };
    conn.execute(
        &format!("UPDATE games SET {column} = ?1 WHERE id = ?2"),
        params![path, game_id],
    )?;
    Ok(())
}
