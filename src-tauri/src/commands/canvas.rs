use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use arris_engines::{
    AppEnvironment, CanvasCellRun, CanvasCellSpec, CanvasEngine, CanvasError,
    CELL_INGEST_BYTE_BUDGET, ErrorCode, IngestedCell, IpcError, ProjectState, QueryEngine,
    QueryResult, QueryValue,
};
use tauri::{Emitter, State};
use uuid::Uuid;

use crate::commands::constants::{CANVAS_CELL_INGESTED_EVENT, CANVAS_RUN_CANCELLED_MESSAGE};
use crate::helpers::ipc_err;

/// Payload for `CANVAS_CELL_INGESTED_EVENT`: a terminal cell's full-ingest
/// totals, emitted once its background drain completes.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CellIngestedEvent {
    board_id: String,
    cell_id: String,
    total_rows: u64,
    complete: bool,
}

/// One executed cell's result shape: totals known now, or an early page whose
/// totals arrive later via `canvas://cell-ingested`.
enum CellOutcome {
    Ingested(IngestedCell),
    Paged(QueryResult),
}

fn canvas_run_error(e: CanvasError, cancelled: &mut bool) -> String {
    *cancelled = matches!(e, CanvasError::Cancelled);
    if *cancelled {
        CANVAS_RUN_CANCELLED_MESSAGE.to_string()
    } else {
        e.to_string()
    }
}

/// Stream a SELECT cell into the cell cache. A terminal cell returns its page
/// early; a spawned drain emits the ingest event (even on error/cancel).
#[allow(clippy::too_many_arguments)]
async fn run_streamed_cell(
    app: &tauri::AppHandle,
    env: &Arc<AppEnvironment>,
    proj: Option<&ProjectState>,
    uuid: Uuid,
    board_id: &str,
    cell: &CanvasCellSpec,
    cell_id: &str,
    query_id: &str,
    is_terminal: bool,
    cancelled: &mut bool,
) -> Result<CellOutcome, String> {
    let opened = env
        .query
        .run_query_stream(
            uuid,
            &env.connection,
            proj,
            cell.sql.clone(),
            cell.limit,
            None,
            Some(query_id.to_string()),
        )
        .await;
    let (stream, token, row_cap) = match opened {
        Ok(o) => o,
        Err(e) => {
            let ipc = IpcError::from(e);
            *cancelled = matches!(ipc.code, ErrorCode::Cancelled);
            return Err(ipc.message);
        }
    };

    if !is_terminal {
        // A dependent reads this cell's full cache: ingest to completion.
        let ingested = env
            .canvas
            .ingest_cell_stream(
                board_id,
                &cell.title,
                stream,
                token.as_ref(),
                CELL_INGEST_BYTE_BUDGET,
                row_cap,
            )
            .await;
        env.query.unregister_query(query_id);
        return ingested
            .map(CellOutcome::Ingested)
            .map_err(|e| canvas_run_error(e, cancelled));
    }

    match env
        .canvas
        .start_cell_ingest(
            board_id,
            &cell.title,
            stream,
            token.as_ref(),
            CELL_INGEST_BYTE_BUDGET,
            row_cap,
        )
        .await
    {
        Ok((page, cont)) => {
            let app = app.clone();
            let env = Arc::clone(env);
            let board = board_id.to_string();
            let cell_id = cell_id.to_string();
            let qid = query_id.to_string();
            let page_rows = page.rows.len() as u64;
            tauri::async_runtime::spawn(async move {
                let done = cont.finish(token.as_ref()).await;
                env.query.unregister_query(&qid);
                // Emit even on error/cancel so the cell's spinner always clears.
                let (total_rows, complete) = match done {
                    Ok(done) => (done.total_rows, done.complete),
                    Err(_) => (page_rows, false),
                };
                let _ = app.emit(
                    CANVAS_CELL_INGESTED_EVENT,
                    CellIngestedEvent {
                        board_id: board,
                        cell_id,
                        total_rows,
                        complete,
                    },
                );
            });
            Ok(CellOutcome::Paged(page))
        }
        Err(e) => {
            env.query.unregister_query(query_id);
            Err(canvas_run_error(e, cancelled))
        }
    }
}

/// Run a canvas query cell after its upstream cells, in the order planned from
/// each cell's SQL references. Cancellable via `cmd_cancel_query` with `query_id`.
#[tauri::command]
pub async fn cmd_run_canvas_cell(
    app: tauri::AppHandle,
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
    // Only a terminal cell (nothing depends on it) gets the early-page +
    // background-finish treatment; anything depended on must fully ingest first.
    let depended_on: HashSet<String> = cells
        .iter()
        .flat_map(|c| {
            CanvasEngine::table_refs(&c.sql)
                .into_iter()
                .filter_map(|r| title_to_id.get(&r))
                .filter(|dep| **dep != c.id)
                .cloned()
                .collect::<Vec<_>>()
        })
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
        let outcome: Result<CellOutcome, String> = if dep_ids.is_empty() {
            // Normal single-connection run: SELECTs stream into the cell cache;
            // everything else runs materialized.
            match cell.connection_id.as_deref() {
                None => Err("pick a connection for this query cell".to_string()),
                Some(conn) => match Uuid::parse_str(conn) {
                    Err(_) => Err("invalid connection id".to_string()),
                    Ok(uuid) if QueryEngine::is_select_query(&cell.sql) => {
                        run_streamed_cell(
                            &app,
                            env.inner(),
                            proj.as_ref(),
                            uuid,
                            &board_id,
                            cell,
                            id,
                            &query_id,
                            !depended_on.contains(id),
                            &mut cancelled,
                        )
                        .await
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
                        // Materialized non-SELECT: cache + totals now (no ingest
                        // event ever fires for this path).
                        run.map(|result| {
                            let _ = env.canvas.cache_result(&board_id, &cell.title, &result);
                            let total_rows = result.rows.len() as u64;
                            CellOutcome::Ingested(IngestedCell {
                                result,
                                total_rows,
                                complete: true,
                            })
                        })
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
                runs.push(CanvasCellRun::ingested(id.clone(), cell_run));
            }
            Ok(CellOutcome::Paged(page)) => {
                runs.push(CanvasCellRun::ok(id.clone(), page));
            }
            Err(message) => {
                failed.insert(id.clone());
                runs.push(CanvasCellRun::failed(id.clone(), message));
            }
        }

        if cancelled {
            // Fail everything still planned so no cell keeps spinning.
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

/// Aggregate (or sample) a chart's data over a source cell's FULL cached result.
/// The frontend's GROUP BY/LIMIT keeps the output small; nothing is cached back.
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

/// One page of a cell's full cached result: rows `[offset, offset + limit)`.
/// `None` when the cell has no cached result (never run or evicted).
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
