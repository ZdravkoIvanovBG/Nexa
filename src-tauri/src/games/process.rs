use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use uuid::Uuid;

use super::model::now_ms;
use super::store::GamesDbState;

const POLL_MS: u64 = 2000;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct ActiveGameSession {
    game_id: String,
    child: Option<Child>,
    started_at: Instant,
    started_at_ms: i64,
    launch_kind: String,
}

pub struct GamesProcessState {
    inner: Arc<Mutex<HashMap<String, ActiveGameSession>>>,
}

impl GamesProcessState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LaunchStartedEvent {
    session_id: String,
    game_id: String,
    kind: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SessionEndedEvent {
    session_id: String,
    game_id: String,
    duration_sec: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSessionSnapshot {
    pub session_id: String,
    pub game_id: String,
    pub started_at_ms: i64,
    pub launch_kind: String,
}

#[tauri::command]
pub async fn games_launch(
    app: AppHandle,
    db: State<'_, GamesDbState>,
    proc: State<'_, GamesProcessState>,
    game_id: String,
) -> Result<String, String> {
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

    let session_id = Uuid::new_v4().to_string();
    let started_at = Instant::now();
    let started_at_ms = now_ms();

    match entry.source_kind.as_str() {
        "direct_exe" => {
            let exe_path = entry
                .exe_path
                .clone()
                .ok_or_else(|| "game has no executable path".to_string())?;
            let mut cmd = Command::new(&exe_path);
            if let Some(dir) = &entry.working_dir {
                cmd.current_dir(dir);
            }
            if let Some(args) = &entry.launch_args {
                for a in args.split_whitespace() {
                    cmd.arg(a);
                }
            }
            cmd.kill_on_drop(true);
            #[cfg(windows)]
            cmd.creation_flags(CREATE_NO_WINDOW);
            let child = cmd.spawn().map_err(|e| format!("spawn game: {e}"))?;

            {
                let mut g = proc.inner.lock().await;
                g.insert(
                    session_id.clone(),
                    ActiveGameSession {
                        game_id: game_id.clone(),
                        child: Some(child),
                        started_at,
                        started_at_ms,
                        launch_kind: entry.source_kind.clone(),
                    },
                );
            }

            let _ = app.emit(
                "games://launch-started",
                &LaunchStartedEvent {
                    session_id: session_id.clone(),
                    game_id: game_id.clone(),
                    kind: entry.source_kind.clone(),
                },
            );

            let app2 = app.clone();
            let proc_arc = proc.inner.clone();
            let db_conn = db.conn.clone();
            let sid = session_id.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(POLL_MS)).await;
                    let exited = {
                        let mut g = proc_arc.lock().await;
                        match g.get_mut(&sid) {
                            Some(sess) => match sess.child.as_mut() {
                                Some(child) => matches!(child.try_wait(), Ok(Some(_)) | Err(_)),
                                None => true,
                            },
                            None => return,
                        }
                    };
                    if exited {
                        finalize_direct(&app2, &proc_arc, &db_conn, &sid).await;
                        return;
                    }
                }
            });
        }
        "steam_uri" => {
            let app_id = entry
                .external_id
                .clone()
                .ok_or_else(|| "steam game has no app id".to_string())?;
            launch_uri(&super::steam_uri(&app_id))?;
            {
                let mut g = proc.inner.lock().await;
                g.insert(
                    session_id.clone(),
                    ActiveGameSession {
                        game_id: game_id.clone(),
                        child: None,
                        started_at,
                        started_at_ms,
                        launch_kind: entry.source_kind.clone(),
                    },
                );
            }
            let _ = app.emit(
                "games://launch-started",
                &LaunchStartedEvent {
                    session_id: session_id.clone(),
                    game_id: game_id.clone(),
                    kind: entry.source_kind.clone(),
                },
            );
        }
        other => return Err(format!("unsupported source kind: {other}")),
    }

    Ok(session_id)
}

fn launch_uri(uri: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", uri])
            .spawn()
            .map_err(|e| format!("launch uri: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(uri)
            .spawn()
            .map_err(|e| format!("launch uri: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(uri)
            .spawn()
            .map_err(|e| format!("launch uri: {e}"))?;
    }
    Ok(())
}

async fn finalize_direct(
    app: &AppHandle,
    proc_arc: &Arc<Mutex<HashMap<String, ActiveGameSession>>>,
    db_conn: &Arc<std::sync::Mutex<rusqlite::Connection>>,
    session_id: &str,
) {
    let removed = { proc_arc.lock().await.remove(session_id) };
    let Some(mut sess) = removed else { return };
    if let Some(child) = sess.child.as_mut() {
        let _ = child.kill().await;
    }
    let ended_at = now_ms();
    let duration_sec = sess.started_at.elapsed().as_secs_f64();

    let game_id = sess.game_id.clone();
    let started_at_ms = sess.started_at_ms;
    let launch_kind = sess.launch_kind.clone();
    let db_conn = db_conn.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let g = db_conn.lock().map_err(|e| e.to_string())?;
        super::store::record_session_end(
            &g,
            &game_id,
            started_at_ms,
            ended_at,
            duration_sec.round() as i64,
            &launch_kind,
        )
        .map_err(|e| e.to_string())
    })
    .await;

    let _ = app.emit(
        "games://session-ended",
        &SessionEndedEvent {
            session_id: session_id.to_string(),
            game_id: sess.game_id.clone(),
            duration_sec,
        },
    );
}

#[tauri::command]
pub async fn games_active_sessions(
    proc: State<'_, GamesProcessState>,
) -> Result<Vec<ActiveSessionSnapshot>, String> {
    let g = proc.inner.lock().await;
    Ok(g.iter()
        .map(|(id, sess)| ActiveSessionSnapshot {
            session_id: id.clone(),
            game_id: sess.game_id.clone(),
            started_at_ms: sess.started_at_ms,
            launch_kind: sess.launch_kind.clone(),
        })
        .collect())
}

#[tauri::command]
pub async fn games_force_stop(
    app: AppHandle,
    db: State<'_, GamesDbState>,
    proc: State<'_, GamesProcessState>,
    session_id: String,
) -> Result<(), String> {
    let has_child = {
        let g = proc.inner.lock().await;
        match g.get(&session_id) {
            Some(sess) if sess.launch_kind == "direct_exe" => true,
            Some(_) => return Err("this launch can't be force-stopped from Harbor".into()),
            None => return Err("session not found".into()),
        }
    };
    if has_child {
        finalize_direct(&app, &proc.inner, &db.conn, &session_id).await;
    }
    Ok(())
}
