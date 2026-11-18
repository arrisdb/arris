use std::sync::Arc;

use arris_engines::{AppEnvironment, CanvasRecord, CanvasSummary, ErrorCode, IpcError, StoreError};
use serde_json::Value;
use tauri::State;

use crate::commands::constants::NO_PROJECT_OPEN_MESSAGE;
use crate::helpers::ipc_err;

/// A stale save maps to `conflict` so the board reloads instead of failing.
fn store_err(e: StoreError) -> IpcError {
    match e {
        StoreError::RevisionConflict { .. } => IpcError {
            code: ErrorCode::Conflict,
            message: e.to_string(),
        },
        other => ipc_err(other),
    }
}

#[tauri::command]
pub async fn cmd_canvas_list(
    env: State<'_, Arc<AppEnvironment>>,
) -> Result<Vec<CanvasSummary>, IpcError> {
    let proj = env.project.read().await;
    let proj = proj
        .as_ref()
        .ok_or_else(|| ipc_err(NO_PROJECT_OPEN_MESSAGE))?;
    let mut all = proj.canvas_store.list().await.map_err(store_err)?;
    all.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(all)
}

#[tauri::command]
pub async fn cmd_canvas_get(
    env: State<'_, Arc<AppEnvironment>>,
    canvas: String,
) -> Result<CanvasRecord, IpcError> {
    let proj = env.project.read().await;
    let proj = proj
        .as_ref()
        .ok_or_else(|| ipc_err(NO_PROJECT_OPEN_MESSAGE))?;
    proj.canvas_store.get(&canvas).await.map_err(store_err)
}

#[tauri::command]
pub async fn cmd_canvas_create(
    env: State<'_, Arc<AppEnvironment>>,
    title: String,
) -> Result<CanvasRecord, IpcError> {
    let proj = env.project.read().await;
    let proj = proj
        .as_ref()
        .ok_or_else(|| ipc_err(NO_PROJECT_OPEN_MESSAGE))?;
    proj.canvas_store.create(title).await.map_err(store_err)
}

#[tauri::command]
pub async fn cmd_canvas_save(
    env: State<'_, Arc<AppEnvironment>>,
    id: String,
    doc: Value,
    revision: u64,
) -> Result<CanvasRecord, IpcError> {
    let proj = env.project.read().await;
    let proj = proj
        .as_ref()
        .ok_or_else(|| ipc_err(NO_PROJECT_OPEN_MESSAGE))?;
    proj.canvas_store
        .save(&id, doc, revision)
        .await
        .map_err(store_err)
}

#[tauri::command]
pub async fn cmd_canvas_rename(
    env: State<'_, Arc<AppEnvironment>>,
    id: String,
    title: String,
) -> Result<CanvasRecord, IpcError> {
    let proj = env.project.read().await;
    let proj = proj
        .as_ref()
        .ok_or_else(|| ipc_err(NO_PROJECT_OPEN_MESSAGE))?;
    proj.canvas_store
        .rename(&id, title)
        .await
        .map_err(store_err)
}

#[tauri::command]
pub async fn cmd_canvas_delete(
    env: State<'_, Arc<AppEnvironment>>,
    id: String,
) -> Result<(), IpcError> {
    let proj = env.project.read().await;
    let proj = proj
        .as_ref()
        .ok_or_else(|| ipc_err(NO_PROJECT_OPEN_MESSAGE))?;
    proj.canvas_store.delete(&id).await.map_err(store_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revision_conflict_maps_to_conflict_code() {
        let err = store_err(StoreError::RevisionConflict { current: 3 });
        assert_eq!(err.code, ErrorCode::Conflict);
    }

    #[test]
    fn other_store_errors_map_to_other() {
        let err = store_err(StoreError::NotFound("x".into()));
        assert_eq!(err.code, ErrorCode::Other);
    }
}
