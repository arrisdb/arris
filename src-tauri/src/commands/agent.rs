use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use arris_engines::agent::{AgentEngine, AgentEvent, AgentProfile, AgentProvider};
use arris_engines::{AppEnvironment, IpcError};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

/// Cap on how long we wait to open the connection and read its schema before
/// giving up and running the turn with no schema context. An unreachable DB
/// must never stall the agent turn — the user can still write/explain SQL.
const SCHEMA_FETCH_TIMEOUT: Duration = Duration::from_secs(15);

/// Cap on how many schemas the agent deep-loads. `list_schemas` is lazy
/// (containers only), so each schema costs a `list_schema` round-trip; the cap
/// keeps a many-schema database from blowing the fetch timeout (and the prompt
/// is byte-capped downstream anyway).
const MAX_AGENT_SCHEMAS: usize = 12;

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
    profile: Option<AgentProfile>,
    connection_id: Option<Uuid>,
    prompt: String,
    board_context: Option<String>,
    // A pre-assembled schema block, used by the canvas chat when the board spans
    // several connections: the frontend fetches each connection's schema, labels
    // it with the connection's id and dialect, and sends the combined text here.
    // When present it replaces the single-connection schema the backend would
    // otherwise resolve.
    schema_override: Option<String>,
    turn_id: String,
    resume_session: Option<String>,
) -> Result<(), IpcError> {
    let env = Arc::clone(env.inner());
    let runs = runs.inner().clone();
    let profile = profile.unwrap_or_default();
    let (cancel_tx, cancel_rx) = oneshot::channel();
    runs.inner.lock().await.insert(turn_id.clone(), cancel_tx);
    tokio::spawn(async move {
        run_turn(
            &app,
            &env,
            provider,
            profile,
            connection_id,
            prompt,
            board_context,
            schema_override,
            turn_id.clone(),
            resume_session,
            cancel_rx,
        )
        .await;
        runs.inner.lock().await.remove(&turn_id);
    });
    Ok(())
}

/// Resolve the schema DDL the agent would receive for `connection_id` (the same
/// deep-loaded snapshot a turn inlines). The canvas chat calls this to show a
/// "fetching schema" indicator and to preview the exact context in its panel.
/// Returns an empty string when the connection is unknown or unreadable.
#[tauri::command]
pub async fn cmd_agent_schema_context(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
) -> Result<String, IpcError> {
    let conn = {
        let project = env.project.read().await;
        env.connection
            .find_connection(connection_id, project.as_ref())
            .await
    };
    match conn {
        Some(conn) => Ok(resolve_schema_ddl(env.inner(), &conn).await.unwrap_or_default()),
        None => Ok(String::new()),
    }
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
    profile: AgentProfile,
    connection_id: Option<Uuid>,
    prompt: String,
    board_context: Option<String>,
    schema_override: Option<String>,
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

    // A frontend-assembled schema (the canvas multi-connection case) replaces the
    // single-connection schema we would otherwise resolve. Its dialects are
    // labeled inline per connection, so the prompt stays dialect-generic.
    let (dialect, schema_ddl) = match (&conn, schema_override) {
        (_, Some(over)) => (conn.as_ref().map(|c| c.kind), over),
        (Some(conn), None) => {
            let schema = resolve_schema_ddl(env, conn).await.unwrap_or_else(|| {
                eprintln!("[agent] schema unavailable for connection; continuing without it");
                String::new()
            });
            (Some(conn.kind), schema)
        }
        (None, None) => (None, String::new()),
    };

    match env
        .agent
        .send(
            provider,
            profile,
            dialect,
            schema_ddl,
            prompt,
            board_context,
            resume_session,
            cancel,
        )
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
        let mut roots = driver.list_schemas().await.ok()?;
        // `list_schemas` is lazy: it returns schema containers with no relations
        // or columns (those load on expand). Deep-load each schema's tables and
        // columns so the prompt carries the real schema, not just its name.
        let names = AgentEngine::schema_names_to_hydrate(&roots, MAX_AGENT_SCHEMAS);
        let mut loaded = HashMap::new();
        for name in names {
            if let Ok(children) = driver.list_schema(&name).await {
                loaded.insert(name, children);
            }
        }
        AgentEngine::attach_schema_children(&mut roots, &loaded);
        Some(env.agent.schema_ddl(&roots))
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
