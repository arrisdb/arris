use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use arris_engines::agent::{AgentEvent, AgentProvider};
use arris_engines::{AppEnvironment, IpcError};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

/// Cap on how long we wait to open the connection and read its schema before
/// giving up and running the turn with no schema context. An unreachable DB
/// must never stall the agent turn — the user can still write/explain SQL.
const SCHEMA_FETCH_TIMEOUT: Duration = Duration::from_secs(15);

/// Registry of in-flight agent turns, keyed by turn id. Each entry holds a
/// one-shot sender that, when fired, cancels that turn (killing its codex
/// process). Managed as Tauri state so the Stop button can reach it.
#[derive(Clone, Default)]
pub struct AgentRuns {
    inner: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
}

/// One streamed agent event, tagged with the originating turn so the frontend
/// can route it to the right thread.
#[derive(Clone, Serialize)]
struct AgentEventEnvelope {
    turn_id: String,
    #[serde(flatten)]
    event: AgentEvent,
}

/// A provider's CLI availability plus the model it will use (for the panel).
#[derive(Serialize)]
pub struct AgentStatus {
    available: bool,
    model: String,
}

/// Start one agent turn for `connection_id`. Returns immediately; all the work
/// (resolving the connection, best-effort reading its schema, spawning codex,
/// and streaming parsed events on the `agent-event` channel) runs in a detached
/// task. Any failure is surfaced as an `error` event followed by `done`, so the
/// frontend's streaming indicator always clears — a slow or unreachable DB can
/// never leave the turn hanging.
#[tauri::command]
pub async fn cmd_agent_send(
    app: AppHandle,
    env: State<'_, Arc<AppEnvironment>>,
    runs: State<'_, AgentRuns>,
    provider: AgentProvider,
    connection_id: Option<Uuid>,
    prompt: String,
    turn_id: String,
    resume_session: Option<String>,
) -> Result<(), IpcError> {
    let env = Arc::clone(env.inner());
    let runs = runs.inner().clone();
    let (cancel_tx, cancel_rx) = oneshot::channel();
    runs.inner.lock().await.insert(turn_id.clone(), cancel_tx);
    tokio::spawn(async move {
        run_turn(
            &app,
            &env,
            provider,
            connection_id,
            prompt,
            turn_id.clone(),
            resume_session,
            cancel_rx,
        )
        .await;
        runs.inner.lock().await.remove(&turn_id);
    });
    Ok(())
}

/// Stop an in-flight agent turn, killing its codex process.
#[tauri::command]
pub async fn cmd_agent_cancel(runs: State<'_, AgentRuns>, turn_id: String) -> Result<(), IpcError> {
    if let Some(cancel) = runs.inner.lock().await.remove(&turn_id) {
        let _ = cancel.send(());
    }
    Ok(())
}

/// Drive one agent turn to completion, emitting every event (including a
/// terminal `error`/`done` on failure) over the `agent-event` channel.
async fn run_turn(
    app: &AppHandle,
    env: &AppEnvironment,
    provider: AgentProvider,
    connection_id: Option<Uuid>,
    prompt: String,
    turn_id: String,
    resume_session: Option<String>,
    cancel: oneshot::Receiver<()>,
) {
    let emit = |event: AgentEvent| {
        let _ = app.emit(
            "agent-event",
            AgentEventEnvelope {
                turn_id: turn_id.clone(),
                event,
            },
        );
    };

    // No connection selected: the agent still writes/explains generic SQL, just
    // without a dialect or live schema. With a connection, resolve it for the
    // dialect and best-effort schema (a missing/slow DB never fails the turn).
    let conn = match connection_id {
        Some(id) => {
            let resolved = {
                let project = env.project.read().await;
                match project.as_ref() {
                    Some(project_state) => {
                        env.connection.find_connection(id, Some(project_state)).await
                    }
                    None => None,
                }
            };
            let Some(conn) = resolved else {
                emit(AgentEvent::Error {
                    message: "Connection not found.".to_string(),
                });
                emit(AgentEvent::Done);
                return;
            };
            Some(conn)
        }
        None => None,
    };

    let (dialect, schema_ddl) = match &conn {
        Some(conn) => {
            let schema = resolve_schema_ddl(env, conn).await.unwrap_or_else(|| {
                eprintln!("[agent] schema unavailable for connection; continuing without it");
                String::new()
            });
            (Some(conn.kind), schema)
        }
        None => (None, String::new()),
    };

    match env
        .agent
        .send(provider, dialect, schema_ddl, prompt, resume_session, cancel)
        .await
    {
        Ok(mut rx) => {
            while let Some(event) = rx.recv().await {
                emit(event);
            }
        }
        Err(err) => {
            emit(AgentEvent::Error {
                message: err.to_string(),
            });
            emit(AgentEvent::Done);
        }
    }
}

/// Open the connection and render its schema as DDL, bounded by
/// [`SCHEMA_FETCH_TIMEOUT`]. Returns `None` on timeout or any driver error.
async fn resolve_schema_ddl(
    env: &AppEnvironment,
    conn: &arris_engines::ConnectionConfig,
) -> Option<String> {
    let fetch = async {
        let driver = env.connection.open_connection(conn).await.ok()?;
        let schema = driver.list_schemas().await.ok()?;
        Some(env.agent.schema_ddl(&schema))
    };
    tokio::time::timeout(SCHEMA_FETCH_TIMEOUT, fetch)
        .await
        .ok()
        .flatten()
}

/// Whether `provider`'s CLI is available, and the model it is configured to use.
#[tauri::command]
pub async fn cmd_agent_check(provider: AgentProvider) -> Result<AgentStatus, IpcError> {
    Ok(AgentStatus {
        available: provider.check().await,
        model: provider.active_model(),
    })
}
