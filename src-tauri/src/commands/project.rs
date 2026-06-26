use std::path::Path;
use std::sync::Arc;

use arris_engines::{AppEnvironment, IpcError, ProjectOpenResult};
use tauri::{Emitter, State};

use crate::helpers::ipc_err;
use crate::watcher::ProjectWatcher;

#[tauri::command]
pub async fn cmd_open_project(
    app: tauri::AppHandle,
    env: State<'_, Arc<AppEnvironment>>,
    watcher: State<'_, ProjectWatcher>,
    root: String,
) -> Result<ProjectOpenResult, IpcError> {
    let result = env.open_project(root.clone()).await.map_err(ipc_err)?;

    // Watch the project root so the file tree and git changes pane refresh live,
    // instead of only when the window regains focus.
    let app_handle = app.clone();
    if let Err(err) = watcher.start(Path::new(&root), move || {
        let _ = app_handle.emit("fs:changed", ());
    }) {
        tracing::warn!("failed to start filesystem watcher for {root}: {err}");
    }

    Ok(result)
}

#[tauri::command]
pub async fn cmd_close_project(
    env: State<'_, Arc<AppEnvironment>>,
    watcher: State<'_, ProjectWatcher>,
) -> Result<(), IpcError> {
    watcher.stop();
    env.close_project().await;
    Ok(())
}
