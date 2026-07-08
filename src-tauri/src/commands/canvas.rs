use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use arris_engines::{
    AppEnvironment, CanvasCellRun, CanvasCellSpec, CanvasEngine, ErrorCode, IpcError, QueryValue,
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
        let outcome: Result<arris_engines::QueryResult, String> = if dep_ids.is_empty() {
            // Normal single-connection run (covers a cell that only reads live
            // tables). The result is cached below so downstream cells can read it.
            match cell.connection_id.as_deref() {
                None => Err("pick a connection for this query cell".to_string()),
                Some(conn) => match Uuid::parse_str(conn) {
                    Err(_) => Err("invalid connection id".to_string()),
                    Ok(uuid) => env
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
                        }),
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
                    r.map_err(|e| e.to_string())
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
            Ok(result) => {
                // Chained cells cache themselves inside run_cell; cache the
                // normal-path cells here so they can feed downstream.
                if dep_ids.is_empty() {
                    let _ = env.canvas.cache_result(&board_id, &cell.title, &result);
                }
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
