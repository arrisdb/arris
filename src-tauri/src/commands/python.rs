use std::path::PathBuf;
use std::sync::Arc;

use arris_engines::{
    AppEnvironment, Completion, CreatedVenv, IpcError, KernelOutput, PythonInterpreter,
    QueryLanguage,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::helpers::ipc_err;

/// Payload for the `python-output` event: a kernel output tagged with the
/// console it belongs to so the frontend can route it to the right tab.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PythonOutputEvent {
    console_id: String,
    output: KernelOutput,
}

#[tauri::command]
pub async fn cmd_python_list_interpreters(
    env: State<'_, Arc<AppEnvironment>>,
) -> Result<Vec<PythonInterpreter>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.python.list_interpreters())
        .await
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_python_add_interpreter(
    env: State<'_, Arc<AppEnvironment>>,
    python: PathBuf,
) -> Result<PythonInterpreter, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.python.add_interpreter(&python))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_python_create_venv(
    env: State<'_, Arc<AppEnvironment>>,
    base_python: PathBuf,
    dest: PathBuf,
) -> Result<CreatedVenv, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.python.create_venv(&base_python, &dest))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_python_ensure_kernel(
    env: State<'_, Arc<AppEnvironment>>,
    python: PathBuf,
) -> Result<bool, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.python.ensure_kernel(&python))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

/// Start (or restart) the kernel for a console and forward its output to the
/// frontend via the `python-output` event until the kernel stops.
#[tauri::command]
pub async fn cmd_python_start_kernel(
    env: State<'_, Arc<AppEnvironment>>,
    app: AppHandle,
    console_id: String,
    python: PathBuf,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    let mut rx = env
        .python
        .start_kernel(console_id.clone(), &python)
        .await
        .map_err(ipc_err)?;
    tokio::spawn(async move {
        while let Some(output) = rx.recv().await {
            let _ = app.emit(
                "python-output",
                PythonOutputEvent {
                    console_id: console_id.clone(),
                    output,
                },
            );
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn cmd_python_execute(
    env: State<'_, Arc<AppEnvironment>>,
    console_id: String,
    code: String,
) -> Result<String, IpcError> {
    let env = env.inner().clone();
    env.python
        .execute(&console_id, code)
        .await
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_python_complete(
    env: State<'_, Arc<AppEnvironment>>,
    console_id: String,
    code: String,
    cursor_pos: usize,
) -> Result<Completion, IpcError> {
    env.inner()
        .python
        .complete(&console_id, code, cursor_pos)
        .await
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_python_interrupt(
    env: State<'_, Arc<AppEnvironment>>,
    console_id: String,
) -> Result<(), IpcError> {
    env.inner().python.interrupt(&console_id).map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_python_shutdown(
    env: State<'_, Arc<AppEnvironment>>,
    console_id: String,
) -> Result<(), IpcError> {
    env.inner().python.shutdown(&console_id).await;
    Ok(())
}

/// Run a notebook SQL cell: execute `sql` against `connection_id`, then bind the
/// result into the console's kernel as a pandas DataFrame named `var_name`.
/// Returns the kernel `execute_request` id so the preview/summary output routes
/// back to the originating cell, exactly like a Python cell.
#[tauri::command]
pub async fn cmd_notebook_run_sql(
    env: State<'_, Arc<AppEnvironment>>,
    console_id: String,
    connection_id: Uuid,
    sql: String,
    var_name: String,
    language: Option<QueryLanguage>,
) -> Result<String, IpcError> {
    let proj = env.project.read().await;
    let result = env
        .query
        .run_query(
            connection_id,
            &env.connection,
            proj.as_ref(),
            sql,
            Vec::new(),
            language,
            None,
            None,
            None,
        )
        .await
        .map_err(IpcError::from)?;
    drop(proj);
    env.python
        .run_sql_cell(&console_id, &result, &var_name)
        .await
        .map_err(ipc_err)
}
