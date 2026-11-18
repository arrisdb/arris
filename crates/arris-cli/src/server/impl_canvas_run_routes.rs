use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use arris_engines::query::{QueryError, QueryRequest};
use arris_engines::{
    CELL_INGEST_BYTE_BUDGET, CanvasCellRun, CanvasCellSpec, CanvasEngine, CanvasError,
    DatabaseDriver, DriverError, IngestedCell, ProjectState, QueryEngine, QueryLanguage,
    QueryResult,
};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use tokio::sync::RwLock;
use uuid::Uuid;

use super::impl_api_routes::{ApiResult, ApiState, Body};
use super::{
    ApiError, ApiRoutes, CANVAS_FETCH_PAGE_ROUTE, CANVAS_INVALID_CONNECTION_MESSAGE,
    CANVAS_MIXED_REFS_MESSAGE, CANVAS_NO_CONNECTION_MESSAGE, CANVAS_QUERY_CACHE_ROUTE,
    CANVAS_RUN_CANCELLED_MESSAGE, CANVAS_RUN_CELL_ROUTE, CANVAS_UPSTREAM_FAILED_MESSAGE,
    CanvasCellIngestedPayload, CanvasFetchPageRequest, CanvasQueryCacheRequest, CanvasRoutes,
    CanvasRunCellRequest, EmptyResponse, MONGO_SHELL_STMT_PREFIX, QUERY_CANCEL_ROUTE,
    QueryCancelRequest, ServerEvent, ServerEventKind, ServerState,
};

/// Canvas cell execution: chained runs, cache queries, cell pages and cancel.
pub struct CanvasRunRoutes;

/// One executed cell: totals known now, or an early page whose totals arrive by event.
enum CellOutcome {
    Ingested(IngestedCell),
    Paged(QueryResult),
}

/// Shared context for one `canvas_run_cell` request.
struct BoardRun<'a> {
    state: &'a Arc<ServerState>,
    project: &'a Arc<RwLock<ProjectState>>,
    root: PathBuf,
    board_id: &'a str,
    query_id: &'a str,
}

impl CanvasRunRoutes {
    pub fn router() -> Router<Arc<ServerState>> {
        Router::new()
            .route(CANVAS_RUN_CELL_ROUTE, post(Self::canvas_run_cell))
            .route(CANVAS_QUERY_CACHE_ROUTE, post(Self::canvas_query_cache))
            .route(CANVAS_FETCH_PAGE_ROUTE, post(Self::canvas_fetch_page))
            .route(QUERY_CANCEL_ROUTE, post(Self::query_cancel))
    }

    /// Mongo shell statements run natively; every other cell goes through the SQL frontend.
    fn cell_query_language(sql: &str) -> QueryLanguage {
        if sql.trim_start().starts_with(MONGO_SHELL_STMT_PREFIX) {
            QueryLanguage::Native
        } else {
            QueryLanguage::Sql
        }
    }

    /// 404 unless `board_id` names a canvas in the header's project.
    async fn require_board(
        state: &ServerState,
        headers: &HeaderMap,
        board_id: &str,
    ) -> Result<Arc<RwLock<ProjectState>>, ApiError> {
        let project = ApiRoutes::project(state, headers).await?;
        project
            .read()
            .await
            .canvas_store
            .get(board_id)
            .await
            .map_err(CanvasRoutes::map_err)?;
        Ok(project)
    }

    fn canvas_error(e: CanvasError, cancelled: &mut bool) -> String {
        *cancelled = matches!(e, CanvasError::Cancelled);
        if *cancelled {
            CANVAS_RUN_CANCELLED_MESSAGE.to_owned()
        } else {
            e.to_string()
        }
    }

    fn query_error(e: QueryError, cancelled: &mut bool) -> String {
        *cancelled = matches!(e, QueryError::Driver(DriverError::Cancelled));
        e.to_string()
    }

    async fn canvas_run_cell(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<CanvasRunCellRequest>,
    ) -> ApiResult<Vec<CanvasCellRun>> {
        let Json(req) = body?;
        let project = Self::require_board(&state, &headers, &req.board_id).await?;
        let order = CanvasEngine::plan(&req.cells, &req.target_id)
            .map_err(|e| ApiError::CanvasPlan(e.to_string()))?;
        let root = project.read().await.root.clone();
        let run = BoardRun {
            state: &state,
            project: &project,
            root,
            board_id: &req.board_id,
            query_id: &req.query_id,
        };
        Ok(Json(run.execute(&req.cells, &order).await))
    }

    async fn canvas_query_cache(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<CanvasQueryCacheRequest>,
    ) -> ApiResult<QueryResult> {
        let Json(req) = body?;
        Self::require_board(&state, &headers, &req.board_id).await?;
        // Bad chart SQL is the caller's error, not a cache failure.
        let result = state
            .env
            .canvas
            .query_cache(&req.board_id, &req.sql)
            .await
            .map_err(|e| QueryError::Other(e.to_string()))?;
        Ok(Json(result))
    }

    async fn canvas_fetch_page(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<CanvasFetchPageRequest>,
    ) -> ApiResult<Option<QueryResult>> {
        let Json(req) = body?;
        Self::require_board(&state, &headers, &req.board_id).await?;
        let page =
            state
                .env
                .canvas
                .fetch_page(&req.board_id, &req.cell_id, req.offset, req.limit)?;
        Ok(Json(page))
    }

    async fn query_cancel(
        State(state): ApiState,
        body: Body<QueryCancelRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        state.env.query.cancel_query(req.query_id).await?;
        Ok(Json(EmptyResponse {}))
    }
}

impl BoardRun<'_> {
    /// Run cells in planned order; a failed upstream blocks its dependents.
    async fn execute(&self, cells: &[CanvasCellSpec], order: &[String]) -> Vec<CanvasCellRun> {
        let by_id: HashMap<&str, &CanvasCellSpec> =
            cells.iter().map(|c| (c.id.as_str(), c)).collect();
        let title_to_id: HashMap<String, String> = cells
            .iter()
            .map(|c| (CanvasEngine::sanitize_ident(&c.title), c.id.clone()))
            .collect();
        let dep_ids_of = |cell: &CanvasCellSpec| -> Vec<String> {
            CanvasEngine::table_refs(&cell.sql)
                .iter()
                .filter_map(|r| title_to_id.get(r))
                .filter(|dep| **dep != cell.id)
                .cloned()
                .collect()
        };
        // Only a terminal cell streams its page early; anything depended on must fully ingest.
        let depended_on: HashSet<String> = cells.iter().flat_map(dep_ids_of).collect();
        let mut failed: HashSet<String> = HashSet::new();
        let mut runs: Vec<CanvasCellRun> = Vec::new();

        for (idx, id) in order.iter().enumerate() {
            let Some(cell) = by_id.get(id.as_str()).copied() else {
                continue;
            };
            let dep_ids = dep_ids_of(cell);
            if dep_ids.iter().any(|d| failed.contains(d)) {
                failed.insert(id.clone());
                runs.push(CanvasCellRun::failed(
                    id.clone(),
                    CANVAS_UPSTREAM_FAILED_MESSAGE.to_owned(),
                ));
                continue;
            }
            let has_live_ref = CanvasEngine::table_refs(&cell.sql)
                .iter()
                .any(|r| !title_to_id.contains_key(r));
            let mut cancelled = false;
            let outcome = if dep_ids.is_empty() {
                self.live_cell(cell, !depended_on.contains(id), &mut cancelled)
                    .await
            } else if has_live_ref {
                Err(CANVAS_MIXED_REFS_MESSAGE.to_owned())
            } else {
                self.chained_cell(cell, &title_to_id, &mut cancelled).await
            };
            match outcome {
                Ok(CellOutcome::Ingested(done)) => {
                    runs.push(CanvasCellRun::ingested(id.clone(), done));
                }
                Ok(CellOutcome::Paged(page)) => runs.push(CanvasCellRun::ok(id.clone(), page)),
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
                        CANVAS_RUN_CANCELLED_MESSAGE.to_owned(),
                    ));
                }
                break;
            }
        }
        runs
    }

    /// A cell with no upstream runs on its connection; the driver connects outside the lock.
    async fn live_cell(
        &self,
        cell: &CanvasCellSpec,
        terminal: bool,
        cancelled: &mut bool,
    ) -> Result<CellOutcome, String> {
        let conn = cell
            .connection_id
            .as_deref()
            .ok_or_else(|| CANVAS_NO_CONNECTION_MESSAGE.to_owned())?;
        let uuid =
            Uuid::parse_str(conn).map_err(|_| CANVAS_INVALID_CONNECTION_MESSAGE.to_owned())?;
        let env = &self.state.env;
        let config = {
            let project = self.project.read().await;
            env.connection.find_connection(uuid, Some(&project)).await
        }
        .ok_or_else(|| ApiError::ConnectionNotFound(conn.to_owned()).to_string())?;
        let driver = env
            .connection
            .open_connection(&config)
            .await
            .map_err(|e| e.to_string())?;
        if QueryEngine::is_select_query(&cell.sql) {
            return self
                .streamed_cell(driver, uuid, cell, terminal, cancelled)
                .await;
        }
        // Materialized non-SELECT: cached now, so no ingest event ever fires.
        let result = env
            .query
            .run_query_on(
                driver,
                env.connection.transaction_config(uuid).await,
                QueryRequest {
                    sql: cell.sql.clone(),
                    params: Vec::new(),
                    language: Some(CanvasRunRoutes::cell_query_language(&cell.sql)),
                    page_size: None,
                    page: None,
                    query_id: Some(self.query_id.to_owned()),
                },
            )
            .await
            .map_err(|e| CanvasRunRoutes::query_error(e, cancelled))?;
        if let Err(e) = env.canvas.cache_result(self.board_id, &cell.id, &result) {
            eprintln!("could not cache canvas cell {}: {e}", cell.id);
        }
        let total_rows = result.rows.len() as u64;
        Ok(CellOutcome::Ingested(IngestedCell {
            result,
            total_rows,
            complete: true,
        }))
    }

    /// Stream a SELECT into the cell cache; a terminal cell returns its page early.
    async fn streamed_cell(
        &self,
        driver: Arc<dyn DatabaseDriver>,
        uuid: Uuid,
        cell: &CanvasCellSpec,
        terminal: bool,
        cancelled: &mut bool,
    ) -> Result<CellOutcome, String> {
        let env = &self.state.env;
        let (stream, token, row_cap) = env
            .query
            .run_query_stream_on(
                driver,
                env.connection.transaction_config(uuid).await,
                cell.sql.clone(),
                cell.limit,
                Some(CanvasRunRoutes::cell_query_language(&cell.sql)),
                Some(self.query_id.to_owned()),
            )
            .await
            .map_err(|e| CanvasRunRoutes::query_error(e, cancelled))?;
        if !terminal {
            let ingested = env
                .canvas
                .ingest_cell_stream(
                    self.board_id,
                    &cell.id,
                    stream,
                    token.as_ref(),
                    CELL_INGEST_BYTE_BUDGET,
                    row_cap,
                )
                .await;
            env.query.unregister_query(self.query_id);
            return ingested
                .map(CellOutcome::Ingested)
                .map_err(|e| CanvasRunRoutes::canvas_error(e, cancelled));
        }
        let started = env
            .canvas
            .start_cell_ingest(
                self.board_id,
                &cell.id,
                stream,
                token.as_ref(),
                CELL_INGEST_BYTE_BUDGET,
                row_cap,
            )
            .await;
        let (page, cont) = match started {
            Ok(started) => started,
            Err(e) => {
                env.query.unregister_query(self.query_id);
                return Err(CanvasRunRoutes::canvas_error(e, cancelled));
            }
        };
        let state = Arc::clone(self.state);
        let root = self.root.clone();
        let board_id = self.board_id.to_owned();
        let cell_id = cell.id.clone();
        let query_id = self.query_id.to_owned();
        let page_rows = page.rows.len() as u64;
        tokio::spawn(async move {
            let done = cont.finish(token.as_ref()).await;
            state.env.query.unregister_query(&query_id);
            // Emit even on error or cancel so the cell's spinner always clears.
            let (total_rows, complete) = match done {
                Ok(done) => (done.total_rows, done.complete),
                Err(_) => (page_rows, false),
            };
            let payload = CanvasCellIngestedPayload {
                board_id,
                cell_id,
                total_rows,
                complete,
            };
            state.emit(ServerEvent {
                kind: ServerEventKind::CanvasCellIngested,
                project: Some(root),
                payload: serde_json::to_value(payload).unwrap_or_default(),
            });
        });
        Ok(CellOutcome::Paged(page))
    }

    /// DataFusion over cached upstream cells; raced against the cancel token.
    async fn chained_cell(
        &self,
        cell: &CanvasCellSpec,
        title_to_id: &HashMap<String, String>,
        cancelled: &mut bool,
    ) -> Result<CellOutcome, String> {
        let env = &self.state.env;
        let token = env.query.register_cancel_token(self.query_id.to_owned());
        let out = tokio::select! {
            r = env.canvas.run_cell(self.board_id, &cell.id, &cell.sql, title_to_id) => {
                r.map(CellOutcome::Ingested).map_err(|e| e.to_string())
            }
            _ = token.cancelled() => {
                *cancelled = true;
                Err(CANVAS_RUN_CANCELLED_MESSAGE.to_owned())
            }
        };
        env.query.unregister_query(self.query_id);
        out
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use arris_engines::ConnectionConfig;
    use reqwest::StatusCode;
    use serde_json::{Value, json};
    use uuid::Uuid;

    use crate::server::impl_api_routes::tests::{Harness, SLOW_SQL, error_code, next_kind};
    use crate::server::{CANVAS_RUN_CANCELLED_MESSAGE, ServerEventKind};

    const SEEDED_ROWS: usize = 5;
    const CANCEL_RETRY: Duration = Duration::from_millis(20);
    const CANCEL_TIMEOUT: Duration = Duration::from_secs(10);

    async fn board(h: &Harness) -> String {
        let made = h.ok("canvas_create", json!({ "title": "Board" })).await;
        made["id"].as_str().unwrap().to_owned()
    }

    async fn seeded(h: &Harness) -> ConnectionConfig {
        let cfg = h.save_sqlite("local").await;
        h.seed_rows(&cfg, SEEDED_ROWS).await;
        cfg
    }

    fn cell(id: &str, title: &str, sql: &str, conn: Option<&ConnectionConfig>) -> Value {
        json!({ "id": id, "title": title, "sql": sql,
                "connectionId": conn.map(|c| c.id.to_string()) })
    }

    async fn run(h: &Harness, board: &str, target: &str, cells: Vec<Value>) -> Vec<Value> {
        let body = json!({ "boardId": board, "targetId": target, "cells": cells,
                           "queryId": Uuid::new_v4().to_string() });
        h.ok("canvas_run_cell", body)
            .await
            .as_array()
            .unwrap()
            .clone()
    }

    /// Waits for the terminal cell's background ingest so the cache is final.
    async fn run_terminal(h: &Harness, board: &str, cfg: &ConnectionConfig) -> Vec<Value> {
        let mut events = h.state.events.subscribe();
        let cells = vec![cell("src", "Src", "SELECT x FROM t", Some(cfg))];
        let runs = run(h, board, "src", cells).await;
        let event = next_kind(&mut events).await;
        assert_eq!(event.kind, ServerEventKind::CanvasCellIngested);
        assert_eq!(event.payload["cellId"], "src");
        assert_eq!(event.payload["totalRows"], SEEDED_ROWS);
        assert_eq!(event.payload["complete"], true);
        runs
    }

    #[tokio::test]
    async fn run_cell_returns_page_and_caches() {
        let h = Harness::start().await;
        let cfg = seeded(&h).await;
        let board = board(&h).await;
        let runs = run_terminal(&h, &board, &cfg).await;
        assert_eq!(runs.len(), 1);
        assert_eq!(
            runs[0]["result"]["rows"].as_array().unwrap().len(),
            SEEDED_ROWS
        );
        let body = json!({ "boardId": board, "cellId": "src", "offset": 1, "limit": 2 });
        let page = h.ok("canvas_fetch_page", body).await;
        assert_eq!(page["rows"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn chained_cell_reads_upstream_by_title() {
        let h = Harness::start().await;
        let cfg = seeded(&h).await;
        let board = board(&h).await;
        let cells = vec![
            cell("src", "Src", "SELECT x FROM t", Some(&cfg)),
            cell("agg", "Agg", "SELECT count(*) AS n FROM Src", None),
        ];
        let runs = run(&h, &board, "agg", cells).await;
        assert_eq!(runs.len(), 2);
        assert_eq!(runs[0]["totalRows"], SEEDED_ROWS);
        assert!(runs[1].get("error").is_none(), "{}", runs[1]);
        assert_eq!(runs[1]["result"]["rows"][0][0]["value"], SEEDED_ROWS);
    }

    #[tokio::test]
    async fn dependent_cell_with_missing_upstream_reports_error() {
        let h = Harness::start().await;
        let board = board(&h).await;
        let cells = vec![
            cell("src", "Src", "SELECT 1", None),
            cell("agg", "Agg", "SELECT * FROM Src", None),
        ];
        let runs = run(&h, &board, "agg", cells).await;
        assert!(runs[0]["error"].as_str().unwrap().contains("connection"));
        assert!(runs[1]["error"].as_str().unwrap().contains("upstream"));
    }

    #[tokio::test]
    async fn query_cache_aggregates_over_cached_cell() {
        let h = Harness::start().await;
        let cfg = seeded(&h).await;
        let board = board(&h).await;
        run_terminal(&h, &board, &cfg).await;
        let body = json!({ "boardId": board, "sql": "SELECT sum(x) AS s FROM src" });
        let got = h.ok("canvas_query_cache", body).await;
        assert_eq!(got["rows"][0][0]["value"], (1..=SEEDED_ROWS).sum::<usize>());
    }

    #[tokio::test]
    async fn fetch_page_null_when_not_cached() {
        let h = Harness::start().await;
        let board = board(&h).await;
        let body = json!({ "boardId": board, "cellId": "nope", "offset": 0, "limit": 10 });
        assert_eq!(h.ok("canvas_fetch_page", body).await, Value::Null);
    }

    #[tokio::test]
    async fn run_cell_on_foreign_board_is_404() {
        let h = Harness::start().await;
        let other = tempfile::TempDir::new().unwrap();
        let made = h
            .call_at(other.path(), "canvas_create", json!({ "title": "Theirs" }))
            .await
            .json::<Value>()
            .await
            .unwrap();
        for board in [
            made["id"].as_str().unwrap().to_owned(),
            Uuid::new_v4().to_string(),
        ] {
            let body = json!({ "boardId": board, "targetId": "a", "cells": [],
                               "queryId": "q" });
            let (status, code) = error_code(h.call("canvas_run_cell", body).await).await;
            assert_eq!(status, StatusCode::NOT_FOUND);
            assert_eq!(code, "canvas_not_found");
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn query_cancel_stops_slow_cell() {
        let h = Arc::new(Harness::start().await);
        let cfg = h.save_sqlite("local").await;
        let board = board(&h).await;
        let query_id = Uuid::new_v4().to_string();
        let body = json!({ "boardId": board, "targetId": "slow", "queryId": query_id,
                           "cells": [cell("slow", "Slow", SLOW_SQL, Some(&cfg))] });
        let running = {
            let h = h.clone();
            tokio::spawn(async move { h.ok("canvas_run_cell", body).await })
        };
        tokio::time::timeout(CANCEL_TIMEOUT, async {
            while !running.is_finished() {
                h.ok("query_cancel", json!({ "queryId": query_id })).await;
                tokio::time::sleep(CANCEL_RETRY).await;
            }
        })
        .await
        .unwrap();
        let runs = running.await.unwrap();
        let error = runs[0]["error"].as_str().unwrap_or_default();
        assert!(
            error == CANVAS_RUN_CANCELLED_MESSAGE || error.contains("interrupt"),
            "{runs}"
        );
    }
}
