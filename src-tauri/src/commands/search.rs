use std::sync::Arc;

use arris_engines::search::{ContentMatch, FileMatch};
use arris_engines::{AppEnvironment, IpcError};
use tauri::State;

use crate::helpers::ipc_err;

#[tauri::command]
pub async fn cmd_open_file_index(
    root: String,
    env: State<'_, Arc<AppEnvironment>>,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    let root_path = std::path::PathBuf::from(root);
    tokio::task::spawn_blocking(move || env.search.open_index(root_path))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_close_file_index(
    env: State<'_, Arc<AppEnvironment>>,
) -> Result<(), IpcError> {
    env.search.close_index().map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_search_files(
    query: String,
    limit: usize,
    env: State<'_, Arc<AppEnvironment>>,
) -> Result<Vec<FileMatch>, IpcError> {
    env.search.search_files(&query, limit).map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_search_content(
    query: String,
    limit: usize,
    env: State<'_, Arc<AppEnvironment>>,
) -> Result<Vec<ContentMatch>, IpcError> {
    env.search.search_content(&query, limit).map_err(ipc_err)
}
