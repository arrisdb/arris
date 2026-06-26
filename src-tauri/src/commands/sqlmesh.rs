use std::path::PathBuf;
use std::sync::Arc;

use arris_engines::sqlmesh::{
    ColumnLineageGraph, ScannedSqlMeshModel, ScannedSqlMeshProject, SqlMeshCommandResult,
    SqlMeshEnvironmentInfo, SqlMeshGatewayInfo, SqlMeshRenderResult,
};
use arris_engines::{AppEnvironment, IpcError};
use tauri::State;

use crate::helpers::ipc_err;

#[tauri::command]
pub async fn cmd_scan_sqlmesh_project(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
) -> Result<ScannedSqlMeshProject, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.sqlmesh.scan_project(&root))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_sqlmesh_check_cli(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    sqlmesh_binary: Option<String>,
) -> Result<String, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.sqlmesh.check_cli(root, sqlmesh_binary))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_sqlmesh_plan(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    select: String,
    environment: Option<String>,
    args: Vec<String>,
    sqlmesh_binary: Option<String>,
) -> Result<SqlMeshCommandResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || {
        env.sqlmesh
            .plan_model(root, select, environment, args, sqlmesh_binary)
    })
    .await
    .map_err(ipc_err)?
    .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_sqlmesh_promote(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    target: String,
    args: Vec<String>,
    sqlmesh_binary: Option<String>,
) -> Result<SqlMeshCommandResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || {
        env.sqlmesh
            .promote_environment(root, target, args, sqlmesh_binary)
    })
    .await
    .map_err(ipc_err)?
    .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_sqlmesh_test(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    select: String,
    args: Vec<String>,
    sqlmesh_binary: Option<String>,
) -> Result<SqlMeshCommandResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || {
        env.sqlmesh.test_model(root, select, args, sqlmesh_binary)
    })
    .await
    .map_err(ipc_err)?
    .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_sqlmesh_test_target(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    target: String,
    args: Vec<String>,
    sqlmesh_binary: Option<String>,
) -> Result<SqlMeshCommandResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || {
        env.sqlmesh.test_target(root, target, args, sqlmesh_binary)
    })
    .await
    .map_err(ipc_err)?
    .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_sqlmesh_run(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    args: Vec<String>,
    sqlmesh_binary: Option<String>,
) -> Result<SqlMeshCommandResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.sqlmesh.run_models(root, args, sqlmesh_binary))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_sqlmesh_lint(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    select: String,
    args: Vec<String>,
    sqlmesh_binary: Option<String>,
) -> Result<SqlMeshCommandResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.sqlmesh.lint_model(root, select, args, sqlmesh_binary))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_sqlmesh_audit(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    select: String,
    args: Vec<String>,
    sqlmesh_binary: Option<String>,
) -> Result<SqlMeshCommandResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.sqlmesh.audit_model(root, select, args, sqlmesh_binary))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_sqlmesh_render(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    model_name: String,
    sqlmesh_binary: Option<String>,
) -> Result<SqlMeshRenderResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || {
        env.sqlmesh
            .render_model(root, model_name, sqlmesh_binary)
    })
    .await
    .map_err(ipc_err)?
    .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_sqlmesh_column_lineage(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    model_names: Vec<String>,
    models: Vec<ScannedSqlMeshModel>,
    sqlmesh_binary: Option<String>,
) -> Result<ColumnLineageGraph, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || {
        env.sqlmesh
            .column_lineage(root, model_names, sqlmesh_binary, &models)
    })
    .await
    .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_sqlmesh_list_gateways(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
) -> Result<Vec<SqlMeshGatewayInfo>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.sqlmesh.list_gateways(root))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_sqlmesh_list_environments(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    sqlmesh_binary: Option<String>,
) -> Result<Vec<SqlMeshEnvironmentInfo>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.sqlmesh.list_environments(root, sqlmesh_binary))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}
