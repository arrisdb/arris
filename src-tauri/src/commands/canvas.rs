use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use arris_engines::{
    AppEnvironment, CanvasCellRun, CanvasCellSpec, CanvasEngine, CanvasError, ErrorCode,
    IngestedCell, IpcError, QueryEngine, QueryResult, QueryValue,
};
use tauri::State;
use uuid::Uuid;

use crate::commands::constants::CANVAS_RUN_CANCELLED_MESSAGE;
use crate::helpers::ipc_err;

/// Run a canvas query cell, auto-running its upstream cells first.
///
/// The board's query cells are sent as `cells`; the engine plans the run order
/// from each cell's SQL (a `FROM`/`JOIN` reference to another cell's sanitized
/// title is a dependency). Cells are then executed in dependency order:
/// - a cell with no cell dependencies runs against its own connection (the
///   normal single-database path) and its result is cached as Arrow;
/// - a cell that reads only other cells runs in DataFusion, with each referenced
///   cell registered as an in-memory table;
/// - a cell that mixes a live table with a cell reference is rejected for now.
///
/// Every executed cell's result (or error) is returned so the board can refresh
/// each grid. A failed cell blocks its descendants. The run is cancellable via
/// `cmd_cancel_query` with the same `query_id`; a cancel fails the in-flight
/// cell and every cell after it in the plan.
#[tauri::command]
pub async fn cmd_run_canvas_cell(
    env: State<'_, Arc<AppEnvironment>>,
    board_id: String,
    target_id: String,
    cells: Vec<CanvasCellSpec>,
    query_id: String,
) -> Result<Vec<CanvasCellRun>, IpcError> {
    let order = CanvasEngine::plan(&cells, &target_id).map_err(ipc_err)?;

    let by_id: HashMap<&str, &CanvasCellSpec> =
        cells.iter().map(|c| (c.id.as_str(), c)).collect();
    let title_to_id: HashMap<String, String> = cells
        .iter()
        .map(|c| (CanvasEngine::sanitize_title(&c.title), c.id.clone()))
        .collect();

    let proj = env.project.read().await;
    let mut failed: HashSet<String> = HashSet::new();
    let mut runs: Vec<CanvasCellRun> = Vec::new();

    for (idx, id) in order.iter().enumerate() {
        let cell = match by_id.get(id.as_str()) {
            Some(c) => *c,
            None => continue,
        };
        let refs = CanvasEngine::table_refs(&cell.sql);
        // A reference is a dependency when it matches ANOTHER cell's title.
        let dep_ids: Vec<String> = refs
            .iter()
            .filter_map(|r| title_to_id.get(r))
            .filter(|did| *did != id)
            .cloned()
            .collect();
        let has_live_ref = refs.iter().any(|r| !title_to_id.contains_key(r));

        if dep_ids.iter().any(|did| failed.contains(did)) {
            failed.insert(id.clone());
            runs.push(CanvasCellRun::failed(
                id.clone(),
                "blocked: an upstream cell failed".to_string(),
            ));
            continue;
        }

        let mut cancelled = false;
        // A streamed or chained run carries its own totals; the plain
        // `run_query` path (non-SELECT statements) has none.
        enum CellOutcome {
            Ingested(IngestedCell),
            Plain(arris_engines::QueryResult),
        }
        let outcome: Result<CellOutcome, String> = if dep_ids.is_empty() {
            // Normal single-connection run (covers a cell that only reads live
            // tables). SELECTs stream straight into the cell cache (bounded
            // memory, page peel); everything else runs materialized.
            match cell.connection_id.as_deref() {
                None => Err("pick a connection for this query cell".to_string()),
                Some(conn) => match Uuid::parse_str(conn) {
                    Err(_) => Err("invalid connection id".to_string()),
                    Ok(uuid) if QueryEngine::is_streamable_select(&cell.sql) => {
                        let opened = env
                            .query
                            .run_query_stream(
                                uuid,
                                &env.connection,
                                proj.as_ref(),
                                cell.sql.clone(),
                                None,
                                Some(query_id.clone()),
                            )
                            .await;
                        match opened {
                            Err(e) => {
                                let ipc = IpcError::from(e);
                                cancelled = matches!(ipc.code, ErrorCode::Cancelled);
                                Err(ipc.message)
                            }
                            Ok((stream, token)) => {
                                let ingested = env
                                    .canvas
                                    .ingest_cell_stream(
                                        &board_id,
                                        &cell.title,
                                        stream,
                                        token.as_ref(),
                                    )
                                    .await;
                                env.query.unregister_query(&query_id);
                                match ingested {
                                    Ok(cell_run) => Ok(CellOutcome::Ingested(cell_run)),
                                    Err(CanvasError::Cancelled) => {
                                        cancelled = true;
                                        Err(CANVAS_RUN_CANCELLED_MESSAGE.to_string())
                                    }
                                    Err(e) => Err(e.to_string()),
                                }
                            }
                        }
                    }
                    Ok(uuid) => {
                        let run = env
                            .query
                            .run_query(
                                uuid,
                                &env.connection,
                                proj.as_ref(),
                                cell.sql.clone(),
                                Vec::<QueryValue>::new(),
                                None,
                                None,
                                None,
                                Some(query_id.clone()),
                            )
                            .await
                            .map_err(|e| {
                                let ipc = IpcError::from(e);
                                cancelled = matches!(ipc.code, ErrorCode::Cancelled);
                                ipc.message
                            });
                        run.map(CellOutcome::Plain)
                    }
                },
            }
        } else if has_live_ref {
            Err("a cell that joins a live table with another cell's result is not \
                 supported yet; put the live data in its own cell first"
                .to_string())
        } else {
            // DataFusion has no driver to kill, so race the run against the
            // board's cancel token; a cancel abandons the in-flight query.
            let token = env.query.register_cancel_token(query_id.clone());
            let out = tokio::select! {
                r = env.canvas.run_cell(&board_id, &cell.title, &cell.sql) => {
                    r.map(CellOutcome::Ingested).map_err(|e| e.to_string())
                }
                _ = token.cancelled() => {
                    cancelled = true;
                    Err(CANVAS_RUN_CANCELLED_MESSAGE.to_string())
                }
            };
            env.query.unregister_query(&query_id);
            out
        };

        match outcome {
            Ok(CellOutcome::Ingested(cell_run)) => {
                // Streamed and chained runs cached themselves during the run.
                runs.push(CanvasCellRun::ingested(id.clone(), cell_run));
            }
            Ok(CellOutcome::Plain(result)) => {
                // Non-SELECT results are cached here so they can feed downstream.
                let _ = env.canvas.cache_result(&board_id, &cell.title, &result);
                runs.push(CanvasCellRun::ok(id.clone(), result));
            }
            Err(message) => {
                failed.insert(id.clone());
                runs.push(CanvasCellRun::failed(id.clone(), message));
            }
        }

        if cancelled {
            // Fail everything still planned (the target included) so the board
            // never leaves a cell spinning after a cancel.
            for rest in &order[idx + 1..] {
                runs.push(CanvasCellRun::failed(
                    rest.clone(),
                    CANVAS_RUN_CANCELLED_MESSAGE.to_string(),
                ));
            }
            break;
        }
    }

    Ok(runs)
}

/// Aggregate (or sample) a chart's data over the FULL cached result of a source
/// cell. The frontend builds `sql` from the chart spec: a `GROUP BY` over the
/// source cell for reducing charts, or a `LIMIT` sample for raw kinds, so the
/// returned result stays small no matter how many rows the source holds. The
/// result is ephemeral (never cached back).
#[tauri::command]
pub async fn cmd_query_canvas_cache(
    env: State<'_, Arc<AppEnvironment>>,
    board_id: String,
    sql: String,
) -> Result<QueryResult, IpcError> {
    env.canvas
        .query_cache(&board_id, &sql)
        .await
        .map_err(ipc_err)
}

/// One page of a cell's full cached result: rows `[offset, offset + limit)`. The
/// table object pages through large results with this instead of holding them in
/// the webview. Returns `None` when the cell has no cached result (never run or
/// evicted).
#[tauri::command]
pub async fn cmd_fetch_canvas_cell_page(
    env: State<'_, Arc<AppEnvironment>>,
    board_id: String,
    title: String,
    offset: usize,
    limit: usize,
) -> Result<Option<QueryResult>, IpcError> {
    env.canvas
        .fetch_page(&board_id, &title, offset, limit)
        .map_err(ipc_err)
}
