use std::path::PathBuf;
use std::sync::Arc;

use arris_engines::{AppEnvironment, FileTreeEntry, IpcError};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::clipboard::{ClipboardFiles, SystemClipboard};
use crate::helpers::ipc_err;

#[tauri::command]
pub async fn cmd_list_folder_tree(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    skip_dirs: Vec<String>,
) -> Result<FileTreeEntry, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.file.list_folder_tree(root, &skip_dirs))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_write_text_file(
    env: State<'_, Arc<AppEnvironment>>,
    path: PathBuf,
    content: String,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.file.write_text_file(path, content))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_read_text_file(
    env: State<'_, Arc<AppEnvironment>>,
    path: PathBuf,
) -> Result<String, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.file.read_text_file(path))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_read_file_base64(
    env: State<'_, Arc<AppEnvironment>>,
    path: PathBuf,
) -> Result<String, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.file.read_file_base64(path))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

/// Absolute paths of files currently on the OS clipboard (e.g. copied in Finder).
/// Empty when the clipboard holds no files or the platform has no implementation.
#[tauri::command]
pub async fn cmd_read_clipboard_file_paths() -> Result<Vec<String>, IpcError> {
    Ok(SystemClipboard.read_file_paths())
}

/// Open a path with the operating system's default application (e.g. mp3 in the
/// default media player). Used for media files the in-app viewer can't preview.
#[tauri::command]
pub async fn cmd_open_in_default_app(
    app: tauri::AppHandle,
    path: String,
) -> Result<(), IpcError> {
    app.opener().open_path(path, None::<&str>).map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_create_file(
    env: State<'_, Arc<AppEnvironment>>,
    path: PathBuf,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.file.create_file(path))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_create_folder(
    env: State<'_, Arc<AppEnvironment>>,
    path: PathBuf,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.file.create_folder(path))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_rename_entry(
    env: State<'_, Arc<AppEnvironment>>,
    from: PathBuf,
    to: PathBuf,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.file.rename_entry(from, to))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_delete_entry(
    env: State<'_, Arc<AppEnvironment>>,
    path: PathBuf,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.file.delete_entry(path))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_copy_entry(
    env: State<'_, Arc<AppEnvironment>>,
    from: PathBuf,
    to: PathBuf,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.file.copy_entry(from, to))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_move_entry(
    env: State<'_, Arc<AppEnvironment>>,
    from: PathBuf,
    to: PathBuf,
) -> Result<(), IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.file.move_entry(from, to))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_duplicate_entry(
    env: State<'_, Arc<AppEnvironment>>,
    path: PathBuf,
) -> Result<PathBuf, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.file.duplicate_entry(path))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}
