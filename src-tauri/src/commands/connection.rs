use std::sync::Arc;

use arris_engines::connection::ScopedConnection;
use arris_engines::{AppEnvironment, ConnectionConfig, DebugLog, IpcError};
use tauri::State;
use uuid::Uuid;

use crate::helpers::ipc_err;

#[tauri::command]
pub async fn cmd_list_connections(
    env: State<'_, Arc<AppEnvironment>>,
) -> Result<Vec<ScopedConnection>, IpcError> {
    let proj = env.project.read().await;
    Ok(env.connection.all_connections(proj.as_ref()).await)
}

#[tauri::command]
pub async fn cmd_save_connection(
    env: State<'_, Arc<AppEnvironment>>,
    config: ConnectionConfig,
    scope: String,
) -> Result<Vec<ScopedConnection>, IpcError> {
    {
        let mut proj = env.project.write().await;
        env.connection
            .save_connection(config, &scope, proj.as_mut())
            .await
            .map_err(IpcError::from)?;
    }
    let proj = env.project.read().await;
    Ok(env.connection.all_connections(proj.as_ref()).await)
}

#[tauri::command]
pub async fn cmd_reorder_connections(
    env: State<'_, Arc<AppEnvironment>>,
    ids: Vec<Uuid>,
) -> Result<Vec<ScopedConnection>, IpcError> {
    {
        let mut proj = env.project.write().await;
        env.connection
            .reorder_connections(&ids, proj.as_mut())
            .await
            .map_err(IpcError::from)?;
    }
    let proj = env.project.read().await;
    Ok(env.connection.all_connections(proj.as_ref()).await)
}

#[tauri::command]
pub async fn cmd_delete_connection(
    env: State<'_, Arc<AppEnvironment>>,
    id: Uuid,
) -> Result<(), IpcError> {
    let mut proj = env.project.write().await;
    env.connection
        .delete_connection(id, proj.as_mut())
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn cmd_promote_connection(
    env: State<'_, Arc<AppEnvironment>>,
    id: Uuid,
) -> Result<Vec<ScopedConnection>, IpcError> {
    {
        let mut proj = env.project.write().await;
        let p = proj.as_mut().ok_or_else(|| ipc_err("no project open"))?;
        env.connection
            .promote_connection(id, p)
            .await
            .map_err(IpcError::from)?;
    }
    let proj = env.project.read().await;
    Ok(env.connection.all_connections(proj.as_ref()).await)
}

#[tauri::command]
pub async fn cmd_import_connection(
    env: State<'_, Arc<AppEnvironment>>,
    id: Uuid,
) -> Result<Vec<ScopedConnection>, IpcError> {
    {
        let mut proj = env.project.write().await;
        let p = proj.as_mut().ok_or_else(|| ipc_err("no project open"))?;
        env.connection
            .import_connection(id, p)
            .await
            .map_err(IpcError::from)?;
    }
    let proj = env.project.read().await;
    Ok(env.connection.all_connections(proj.as_ref()).await)
}

#[tauri::command]
pub async fn cmd_connect(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
) -> Result<(), IpcError> {
    let cfg = {
        let proj = env.project.read().await;
        env.connection
            .find_connection(connection_id, proj.as_ref())
            .await
            .ok_or_else(|| ipc_err(format!("connection {connection_id} not found")))?
    };
    let kind = format!("{:?}", cfg.kind);
    if let Err(e) = env.connection.open_connection(&cfg).await {
        let ipc = IpcError::from(e);
        DebugLog::connection_failed(&cfg.name, &kind, ipc.code.clone(), &ipc.message);
        return Err(ipc);
    }
    DebugLog::connection_opened(&cfg.name, &kind);
    Ok(())
}

#[tauri::command]
pub async fn cmd_disconnect(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
) -> Result<(), IpcError> {
    env.connection.close_connection(connection_id).await;
    Ok(())
}

#[tauri::command]
pub async fn cmd_test_connection(
    env: State<'_, Arc<AppEnvironment>>,
    config: ConnectionConfig,
) -> Result<(), IpcError> {
    env.connection
        .test_connection(&config)
        .await
        .map_err(IpcError::from)
}
