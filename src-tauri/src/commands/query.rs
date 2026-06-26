use std::sync::Arc;
use std::time::Instant;

use arris_engines::query::QueryEngine;
use arris_engines::{
    AppEnvironment, DebugLog, ExplainMode, IpcError, IsolationLevel, ObjectRef, PlanResult,
    QueryLanguage, QueryResult, QueryValue, TableMutationBatch, TableRef, TransactionConfig,
    TransactionMode,
};
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn cmd_list_schemas(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
) -> Result<Vec<arris_engines::SchemaNode>, IpcError> {
    let proj = env.project.read().await;
    let (conn, kind) = env
        .connection
        .find_connection(connection_id, proj.as_ref())
        .await
        .map(|c| (c.name, format!("{:?}", c.kind)))
        .unwrap_or_else(|| ("unknown".to_string(), "unknown".to_string()));
    DebugLog::schema_load_started(&conn, &kind, "(top-level)");
    let started = Instant::now();
    let result = env
        .query
        .list_schemas(connection_id, &env.connection, proj.as_ref())
        .await;
    match result {
        Ok(nodes) => {
            DebugLog::schema_load_finished(
                &conn,
                &kind,
                "(top-level)",
                started.elapsed().as_millis() as u64,
                nodes.len(),
            );
            Ok(nodes)
        }
        Err(e) => {
            let ipc = IpcError::from(e);
            DebugLog::schema_load_failed(&conn, &kind, "(top-level)", ipc.code.clone(), &ipc.message);
            Err(ipc)
        }
    }
}

#[tauri::command]
pub async fn cmd_list_schema(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
    schema: String,
) -> Result<Vec<arris_engines::SchemaNode>, IpcError> {
    let proj = env.project.read().await;
    let (conn, kind) = env
        .connection
        .find_connection(connection_id, proj.as_ref())
        .await
        .map(|c| (c.name, format!("{:?}", c.kind)))
        .unwrap_or_else(|| ("unknown".to_string(), "unknown".to_string()));
    DebugLog::schema_load_started(&conn, &kind, &schema);
    let started = Instant::now();
    let result = env
        .query
        .list_schema(connection_id, &env.connection, proj.as_ref(), &schema)
        .await;
    match result {
        Ok(nodes) => {
            DebugLog::schema_load_finished(
                &conn,
                &kind,
                &schema,
                started.elapsed().as_millis() as u64,
                nodes.len(),
            );
            Ok(nodes)
        }
        Err(e) => {
            let ipc = IpcError::from(e);
            DebugLog::schema_load_failed(&conn, &kind, &schema, ipc.code.clone(), &ipc.message);
            Err(ipc)
        }
    }
}

#[tauri::command]
pub async fn cmd_run_query(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
    sql: String,
    params: Vec<QueryValue>,
    language: Option<QueryLanguage>,
    page_size: Option<u32>,
    page: Option<u32>,
    query_id: Option<String>,
) -> Result<QueryResult, IpcError> {
    let proj = env.project.read().await;
    let (conn, kind) = env
        .connection
        .find_connection(connection_id, proj.as_ref())
        .await
        .map(|c| (c.name, format!("{:?}", c.kind)))
        .unwrap_or_else(|| ("unknown".to_string(), "unknown".to_string()));
    DebugLog::query_started(&conn, &kind);
    let started = Instant::now();
    let result = env
        .query
        .run_query(
            connection_id,
            &env.connection,
            proj.as_ref(),
            sql,
            params,
            language,
            page_size,
            page,
            query_id,
        )
        .await;
    match result {
        Ok(r) => {
            DebugLog::query_finished(
                &conn,
                &kind,
                started.elapsed().as_millis() as u64,
                r.rows.len(),
            );
            Ok(r)
        }
        Err(e) => {
            let ipc = IpcError::from(e);
            DebugLog::query_failed(&conn, &kind, ipc.code.clone(), &ipc.message);
            Err(ipc)
        }
    }
}

#[tauri::command]
pub async fn cmd_cancel_query(
    env: State<'_, Arc<AppEnvironment>>,
    query_id: String,
) -> Result<(), IpcError> {
    env.query
        .cancel_query(query_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn cmd_explain_query(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
    sql: String,
    params: Vec<QueryValue>,
    language: Option<QueryLanguage>,
    mode: ExplainMode,
) -> Result<PlanResult, IpcError> {
    let proj = env.project.read().await;
    env.query
        .explain_query(
            connection_id,
            &env.connection,
            proj.as_ref(),
            sql,
            params,
            language,
            mode,
        )
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn cmd_primary_key(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
    table: TableRef,
) -> Result<Option<Vec<String>>, IpcError> {
    let proj = env.project.read().await;
    env.query
        .primary_key(connection_id, &env.connection, proj.as_ref(), table)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn cmd_object_definition(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
    object: ObjectRef,
) -> Result<String, IpcError> {
    let proj = env.project.read().await;
    env.query
        .object_definition(connection_id, &env.connection, proj.as_ref(), object)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn cmd_table_browse_query(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
    table: TableRef,
    limit: Option<u32>,
) -> Result<String, IpcError> {
    let proj = env.project.read().await;
    QueryEngine::table_browse_query(
        connection_id,
        &env.connection,
        proj.as_ref(),
        &table,
        limit.unwrap_or(500),
    )
    .await
    .map_err(IpcError::from)
}

#[tauri::command]
pub async fn cmd_apply_mutations(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
    table: TableRef,
    batch: TableMutationBatch,
) -> Result<arris_engines::MutationResult, IpcError> {
    let proj = env.project.read().await;
    env.query
        .apply_mutations(connection_id, &env.connection, proj.as_ref(), table, batch)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn cmd_set_transaction_config(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
    mode: TransactionMode,
    isolation: IsolationLevel,
) -> Result<(), IpcError> {
    // Switching to auto-commit commits any pending manual transaction so no
    // work is left open on the connection.
    if matches!(mode, TransactionMode::Auto) {
        let proj = env.project.read().await;
        if let Ok(driver) = env.connection.driver_for(connection_id, proj.as_ref()).await {
            if driver.in_transaction().await {
                driver.commit_transaction().await.map_err(IpcError::from)?;
            }
        }
    }
    env.connection
        .set_transaction_config(connection_id, TransactionConfig { mode, isolation })
        .await;
    Ok(())
}

#[tauri::command]
pub async fn cmd_commit_transaction(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
) -> Result<(), IpcError> {
    let proj = env.project.read().await;
    env.query
        .commit_transaction(connection_id, &env.connection, proj.as_ref())
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn cmd_rollback_transaction(
    env: State<'_, Arc<AppEnvironment>>,
    connection_id: Uuid,
) -> Result<(), IpcError> {
    let proj = env.project.read().await;
    env.query
        .rollback_transaction(connection_id, &env.connection, proj.as_ref())
        .await
        .map_err(IpcError::from)
}
