use std::sync::Arc;

use arris_engines::federation::{DagNode, FederationEngine, FederationRef, ProgressCallback};
use arris_engines::{
    AppEnvironment, IpcError, JsonCollectionStore, PersistedFederationTab, QueryResult,
};
use tauri::{Emitter, State};

use crate::helpers::ipc_err;

#[tauri::command]
pub async fn cmd_run_federation_query(
    env: State<'_, Arc<AppEnvironment>>,
    app_handle: tauri::AppHandle,
    sql: String,
    query_id: Option<String>,
) -> Result<QueryResult, IpcError> {
    let connections = {
        let proj = env.project.read().await;
        env.connection.all_connections(proj.as_ref()).await
    };

    let handle_plan = app_handle.clone();
    let on_plan: Box<dyn FnOnce(&[DagNode]) + Send> =
        Box::new(move |dag| {
            let _ = handle_plan.emit("federation-plan", dag);
        });

    let handle_progress = app_handle.clone();
    let progress: ProgressCallback = Arc::new(move |event| {
        let _ = handle_progress.emit("federation-progress", &event);
    });

    FederationEngine::run_query(
        &sql,
        &connections,
        &env.connection,
        &env.query,
        query_id,
        on_plan,
        progress,
    )
    .await
    .map_err(ipc_err)
}

#[tauri::command]
pub fn cmd_parse_federation_refs(sql: String) -> Vec<FederationRef> {
    FederationEngine::parse_refs(&sql)
}

#[tauri::command]
pub async fn cmd_load_federation_tabs(
    env: State<'_, Arc<AppEnvironment>>,
) -> Result<Vec<PersistedFederationTab>, IpcError> {
    let proj = env.project.read().await;
    let proj = proj.as_ref().ok_or_else(|| ipc_err("no project open"))?;
    proj.federation_tabs_store.load().await.map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_save_federation_tabs(
    env: State<'_, Arc<AppEnvironment>>,
    tabs: Vec<PersistedFederationTab>,
) -> Result<(), IpcError> {
    let proj = env.project.read().await;
    let proj = proj.as_ref().ok_or_else(|| ipc_err("no project open"))?;
    proj.federation_tabs_store
        .save(&tabs)
        .await
        .map_err(ipc_err)
}
