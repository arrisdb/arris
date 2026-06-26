use std::path::PathBuf;
use std::sync::Arc;

use arris_engines::dbt::{
    ColumnLineageGraph, DbtCommandResult, DbtCompileResult, DbtDocs, DbtProfileInfo, DbtRunResults,
    ScannedNode as DbtScannedNode, ScannedProject as DbtScannedProject, SlimDiffError, SlimDiffMode,
    SlimDiffResult,
};
use arris_engines::{AppEnvironment, DatabaseKind, IpcError};
use tauri::State;
use uuid::Uuid;

use crate::helpers::ipc_err;

#[tauri::command]
pub async fn cmd_scan_dbt_project(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
) -> Result<DbtScannedProject, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.dbt.scan_project(&root))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_dbt_check_cli(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    dbt_binary: Option<String>,
) -> Result<String, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.dbt.check_cli(root, dbt_binary))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_dbt_run(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    select: String,
    args: Vec<String>,
    dbt_binary: Option<String>,
) -> Result<DbtCommandResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.dbt.run_model(root, select, args, dbt_binary))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_dbt_test(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    select: String,
    args: Vec<String>,
    dbt_binary: Option<String>,
) -> Result<DbtCommandResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.dbt.test_model(root, select, args, dbt_binary))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_dbt_build(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    select: String,
    args: Vec<String>,
    dbt_binary: Option<String>,
) -> Result<DbtCommandResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.dbt.build_model(root, select, args, dbt_binary))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_dbt_debug(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    args: Vec<String>,
    dbt_binary: Option<String>,
) -> Result<DbtCommandResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.dbt.debug(root, args, dbt_binary))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_dbt_compile(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    select: String,
    project_name: String,
    dbt_binary: Option<String>,
) -> Result<DbtCompileResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || {
        env.dbt
            .compile_model(root, select, project_name, dbt_binary)
    })
    .await
    .map_err(ipc_err)?
    .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_dbt_docs_generate(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    args: Vec<String>,
    dbt_binary: Option<String>,
) -> Result<DbtCommandResult, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.dbt.docs_generate(root, args, dbt_binary))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_dbt_docs_load(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
) -> Result<DbtDocs, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.dbt.load_docs(root))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_dbt_read_run_results(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
) -> Result<DbtRunResults, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.dbt.load_run_results(root))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_dbt_list_profiles(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
) -> Result<Vec<DbtProfileInfo>, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || env.dbt.list_profiles(root))
        .await
        .map_err(ipc_err)?
        .map_err(ipc_err)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn cmd_dbt_slim_diff(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
    root: PathBuf,
    model: String,
    project_name: String,
    mode: SlimDiffMode,
    sample_size: Option<u32>,
    key_columns: Option<Vec<String>>,
    dbt_binary: Option<String>,
) -> Result<SlimDiffResult, IpcError> {
    let env = env.inner().clone();
    let sample = sample_size.unwrap_or(50);
    let keys = key_columns.unwrap_or_default();

    // Resolve the bound connection's dialect once: the compile step runs
    // off-runtime (can't await) and the diff both need the database kind.
    let kind: DatabaseKind = {
        let proj = env.project.read().await;
        env.connection
            .find_connection(connection_id, proj.as_ref())
            .await
            .map(|c| c.kind)
    }
    .ok_or_else(|| ipc_err(SlimDiffError::ConnectionNotFound(connection_id)))?;

    // Compile + resolve prod relation off the async runtime (CLI + fs).
    let inputs_env = env.clone();
    let (compiled_sql, prod_relation) = tokio::task::spawn_blocking(move || {
        inputs_env
            .dbt
            .slim_diff_inputs(root, model, project_name, kind, dbt_binary)
    })
    .await
    .map_err(ipc_err)?
    .map_err(ipc_err)?;

    let proj = env.project.read().await;
    env.dbt
        .run_slim_diff(
            &env.query,
            &env.connection,
            proj.as_ref(),
            connection_id,
            kind,
            mode,
            sample,
            keys,
            compiled_sql,
            prod_relation,
        )
        .await
        .map_err(ipc_err)
}

#[tauri::command]
pub async fn cmd_dbt_column_lineage(
    env: State<'_, Arc<AppEnvironment>>,
    root: PathBuf,
    model_ids: Vec<String>,
    project_name: String,
    nodes: Vec<DbtScannedNode>,
    dbt_binary: Option<String>,
) -> Result<ColumnLineageGraph, IpcError> {
    let env = env.inner().clone();
    tokio::task::spawn_blocking(move || {
        env.dbt
            .column_lineage(root, model_ids, project_name, dbt_binary, &nodes)
    })
    .await
    .map_err(ipc_err)?
    .map_err(ipc_err)
}
