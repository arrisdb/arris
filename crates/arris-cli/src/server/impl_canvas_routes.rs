use std::sync::Arc;

use arris_engines::{CanvasRecord, CanvasSummary, ProjectState, QueryLanguage, StoreError};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use uuid::Uuid;

use super::impl_api_routes::{ApiResult, ApiState, Body};
use super::{
    ApiError, ApiRoutes, CANVAS_ADD_GAP, CANVAS_ADD_ROUTE, CANVAS_ADD_X, CANVAS_ADD_Y,
    CANVAS_CHART_H, CANVAS_CHART_ROUTE, CANVAS_CHART_W, CANVAS_CREATE_ROUTE, CANVAS_DELETE_ROUTE,
    CANVAS_DOC_COMPONENTS, CANVAS_DOC_ID, CANVAS_DOC_KIND, CANVAS_DOC_SPEC, CANVAS_GET_ROUTE,
    CANVAS_ID_SEPARATOR, CANVAS_KIND_CHART, CANVAS_KIND_QUERY, CANVAS_LIST_ROUTE, CANVAS_QUERY_H,
    CANVAS_QUERY_W, CANVAS_REMOVE_ROUTE, CANVAS_RENAME_ROUTE, CANVAS_SAVE_ROUTE, CANVAS_Z_STEP,
    CanvasAddRequest, CanvasAddResponse, CanvasAddSource, CanvasChangedPayload, CanvasChartRequest,
    CanvasCreateRequest, CanvasDocGeometry, CanvasEdgeDoc, CanvasIdRequest, CanvasObjectRequest,
    CanvasRefRequest, CanvasRenameRequest, CanvasSaveRequest, ChartComponentDoc, ComponentFrame,
    EmptyResponse, HandoffTarget, QueryComponentDoc, QueryHandoff, ServerEventKind, ServerState,
};

/// `canvas_*` handlers: per-project board documents with optimistic revisions.
pub struct CanvasRoutes;

impl CanvasRoutes {
    pub fn router() -> Router<Arc<ServerState>> {
        Router::new()
            .route(CANVAS_LIST_ROUTE, post(Self::canvas_list))
            .route(CANVAS_GET_ROUTE, post(Self::canvas_get))
            .route(CANVAS_CREATE_ROUTE, post(Self::canvas_create))
            .route(CANVAS_SAVE_ROUTE, post(Self::canvas_save))
            .route(CANVAS_RENAME_ROUTE, post(Self::canvas_rename))
            .route(CANVAS_DELETE_ROUTE, post(Self::canvas_delete))
            .route(CANVAS_ADD_ROUTE, post(Self::canvas_add))
            .route(CANVAS_REMOVE_ROUTE, post(Self::canvas_remove))
            .route(CANVAS_CHART_ROUTE, post(Self::canvas_chart))
    }

    pub(super) fn map_err(e: StoreError) -> ApiError {
        match e {
            StoreError::NotFound(id) => ApiError::CanvasNotFound(id),
            StoreError::RevisionConflict { .. } => ApiError::Conflict(e.to_string()),
            StoreError::InvalidDoc(reason) => ApiError::InvalidCanvasDoc(reason),
            other => other.into(),
        }
    }

    fn emit_changed(state: &ServerState, project: &ProjectState, id: &str, revision: u64) {
        let payload = CanvasChangedPayload {
            id: id.to_owned(),
            revision,
        };
        ApiRoutes::emit(state, ServerEventKind::CanvasChanged, project, payload);
    }

    fn require_title(title: &str) -> Result<(), ApiError> {
        if title.trim().is_empty() {
            return Err(ApiError::EmptyTitle);
        }
        Ok(())
    }

    /// UUID resolves by id; anything else by exact title, which must be unique.
    async fn resolve(project: &ProjectState, canvas: &str) -> Result<CanvasRecord, ApiError> {
        if Uuid::parse_str(canvas).is_ok() {
            return project
                .canvas_store
                .get(canvas)
                .await
                .map_err(Self::map_err);
        }
        let matches: Vec<CanvasSummary> = project
            .canvas_store
            .list()
            .await?
            .into_iter()
            .filter(|c| c.title == canvas)
            .collect();
        match matches.as_slice() {
            [] => Err(ApiError::CanvasNotFound(canvas.to_owned())),
            [one] => project
                .canvas_store
                .get(&one.id)
                .await
                .map_err(Self::map_err),
            many => Err(ApiError::Ambiguous(
                many.iter()
                    .map(|c| c.id.as_str())
                    .collect::<Vec<_>>()
                    .join(CANVAS_ID_SEPARATOR),
            )),
        }
    }

    async fn canvas_list(
        State(state): ApiState,
        headers: HeaderMap,
    ) -> ApiResult<Vec<CanvasSummary>> {
        let project = ApiRoutes::project(&state, &headers).await?;
        let mut all = project.read().await.canvas_store.list().await?;
        all.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(Json(all))
    }

    async fn canvas_get(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<CanvasRefRequest>,
    ) -> ApiResult<CanvasRecord> {
        let Json(req) = body?;
        let project = ApiRoutes::project(&state, &headers).await?;
        let project = project.read().await;
        Ok(Json(Self::resolve(&project, &req.canvas).await?))
    }

    async fn canvas_create(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<CanvasCreateRequest>,
    ) -> ApiResult<CanvasRecord> {
        let Json(req) = body?;
        Self::require_title(&req.title)?;
        let project = ApiRoutes::project(&state, &headers).await?;
        let project = project.write().await;
        let record = project.canvas_store.create(req.title).await?;
        Self::emit_changed(&state, &project, &record.id, record.revision);
        Ok(Json(record))
    }

    async fn canvas_save(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<CanvasSaveRequest>,
    ) -> ApiResult<CanvasRecord> {
        let Json(req) = body?;
        let project = ApiRoutes::project(&state, &headers).await?;
        let project = project.write().await;
        let record = project
            .canvas_store
            .save(&req.id, req.doc, req.revision)
            .await
            .map_err(Self::map_err)?;
        Self::emit_changed(&state, &project, &record.id, record.revision);
        Ok(Json(record))
    }

    async fn canvas_rename(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<CanvasRenameRequest>,
    ) -> ApiResult<CanvasRecord> {
        let Json(req) = body?;
        Self::require_title(&req.title)?;
        let project = ApiRoutes::project(&state, &headers).await?;
        let project = project.write().await;
        let record = project
            .canvas_store
            .rename(&req.id, req.title)
            .await
            .map_err(Self::map_err)?;
        Self::emit_changed(&state, &project, &record.id, record.revision);
        Ok(Json(record))
    }

    async fn canvas_delete(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<CanvasIdRequest>,
    ) -> ApiResult<EmptyResponse> {
        let Json(req) = body?;
        let project = ApiRoutes::project(&state, &headers).await?;
        let project = project.write().await;
        // Best effort so a corrupt canvas can still be deleted.
        let revision = project
            .canvas_store
            .get(&req.id)
            .await
            .map_or_else(|_| u64::default(), |r| r.revision);
        project
            .canvas_store
            .delete(&req.id)
            .await
            .map_err(Self::map_err)?;
        Self::emit_changed(&state, &project, &req.id, revision);
        Ok(Json(EmptyResponse {}))
    }
}

// Agent-facing append of a query (and optional bound chart) to a board.
impl CanvasRoutes {
    /// Below the lowest object at the left margin, on top of every z.
    fn next_slot(doc: &serde_json::Value) -> (f64, f64) {
        let geometry: CanvasDocGeometry = serde_json::from_value(doc.clone()).unwrap_or_default();
        let y = geometry
            .components
            .iter()
            .map(|c| c.y + c.h + CANVAS_ADD_GAP)
            .fold(CANVAS_ADD_Y, f64::max);
        let z = geometry
            .components
            .iter()
            .map(|c| c.z + CANVAS_Z_STEP)
            .fold(f64::default(), f64::max);
        (y, z)
    }

    /// The trimmed first non-empty SQL line.
    fn default_title(sql: &str) -> String {
        sql.lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or_default()
            .to_owned()
    }

    async fn canvas_add(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<CanvasAddRequest>,
    ) -> ApiResult<CanvasAddResponse> {
        let Json(req) = body?;
        let project = ApiRoutes::project(&state, &headers).await?;
        let (sql, config) = {
            let guard = project.read().await;
            let (sql, connection) = match req.source {
                CanvasAddSource::FromRun { run_id } => {
                    let run = guard
                        .query_run_store
                        .get(&run_id)
                        .await?
                        .ok_or(ApiError::RunNotFound(run_id))?;
                    (run.sql, run.connection_id.to_string())
                }
                CanvasAddSource::Manual { sql, connection } => (sql, connection),
            };
            let config = ApiRoutes::resolve_connection(&state, &guard, &connection).await?;
            (sql, config)
        };
        // Outside the lock: opening a remote connection can take seconds.
        let auto_run = match state.env.connection.open_connection(&config).await {
            Ok(driver) => driver.is_read_only(&sql, QueryLanguage::default()),
            Err(_) => false,
        };
        let connection_id = config.id;
        // Write lock serializes against browser saves so the slot stays free.
        let guard = project.write().await;
        let record = Self::resolve(&guard, &req.canvas).await?;
        let (y, z) = Self::next_slot(&record.doc);
        let query_id = Uuid::new_v4().to_string();
        let query = QueryComponentDoc {
            frame: ComponentFrame {
                id: query_id.clone(),
                kind: CANVAS_KIND_QUERY,
                x: CANVAS_ADD_X,
                y,
                w: CANVAS_QUERY_W,
                h: CANVAS_QUERY_H,
                z,
            },
            connection_id,
            title: req.title.unwrap_or_else(|| Self::default_title(&sql)),
            sql,
            auto_run,
        };
        let mut components = vec![serde_json::to_value(query).map_err(StoreError::from)?];
        let mut edges = Vec::new();
        let chart_id = req.chart.as_ref().map(|_| Uuid::new_v4().to_string());
        if let (Some(chart_id), Some(spec)) = (&chart_id, req.chart) {
            let chart = ChartComponentDoc {
                frame: ComponentFrame {
                    id: chart_id.clone(),
                    kind: CANVAS_KIND_CHART,
                    x: CANVAS_ADD_X + CANVAS_QUERY_W + CANVAS_ADD_GAP,
                    y,
                    w: CANVAS_CHART_W,
                    h: CANVAS_CHART_H,
                    z: z + CANVAS_Z_STEP,
                },
                source_query_id: query_id.clone(),
                spec,
            };
            components.push(serde_json::to_value(chart).map_err(StoreError::from)?);
            edges.push(
                serde_json::to_value(CanvasEdgeDoc {
                    id: Uuid::new_v4().to_string(),
                    source: query_id.clone(),
                    target: chart_id.clone(),
                })
                .map_err(StoreError::from)?,
            );
        }
        let saved = guard
            .canvas_store
            .append_components(&record.id, components, edges)
            .await
            .map_err(Self::map_err)?;
        Self::emit_changed(&state, &guard, &saved.id, saved.revision);
        let root = guard.root.clone();
        // Released first: the tab saves the board while it opens it.
        drop(guard);
        let handoff = QueryHandoff {
            id: Uuid::new_v4().to_string(),
            target: HandoffTarget::Canvas {
                canvas_id: saved.id.clone(),
                title: saved.title.clone(),
            },
        };
        let (_, launch_browser) = ApiRoutes::hand_off(&state, &project, &root, handoff).await;
        Ok(Json(CanvasAddResponse {
            canvas: saved.into(),
            query_id,
            chart_id,
            launch_browser,
        }))
    }
}

// Agent-facing edits of one object; the browser reloads on the change event.
impl CanvasRoutes {
    /// The object's `kind`, or `CanvasObjectNotFound`.
    fn object_kind(doc: &serde_json::Value, id: &str) -> Result<String, ApiError> {
        doc.get(CANVAS_DOC_COMPONENTS)
            .and_then(serde_json::Value::as_array)
            .and_then(|list| {
                list.iter()
                    .find(|c| c.get(CANVAS_DOC_ID).and_then(|v| v.as_str()) == Some(id))
            })
            .and_then(|c| c.get(CANVAS_DOC_KIND).and_then(|v| v.as_str()))
            .map(str::to_owned)
            .ok_or_else(|| ApiError::CanvasObjectNotFound(id.to_owned()))
    }

    async fn canvas_remove(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<CanvasObjectRequest>,
    ) -> ApiResult<CanvasSummary> {
        let Json(req) = body?;
        let project = ApiRoutes::project(&state, &headers).await?;
        let project = project.write().await;
        let record = Self::resolve(&project, &req.canvas).await?;
        Self::object_kind(&record.doc, &req.id)?;
        let saved = project
            .canvas_store
            .remove_component(&record.id, &req.id)
            .await
            .map_err(Self::map_err)?;
        Self::emit_changed(&state, &project, &saved.id, saved.revision);
        Ok(Json(saved.into()))
    }

    async fn canvas_chart(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<CanvasChartRequest>,
    ) -> ApiResult<CanvasSummary> {
        let Json(req) = body?;
        let project = ApiRoutes::project(&state, &headers).await?;
        let project = project.write().await;
        let record = Self::resolve(&project, &req.canvas).await?;
        if Self::object_kind(&record.doc, &req.id)? != CANVAS_KIND_CHART {
            return Err(ApiError::NotAChart(req.id));
        }
        let mut patch = serde_json::Map::new();
        let spec = serde_json::to_value(req.spec).map_err(StoreError::from)?;
        patch.insert(CANVAS_DOC_SPEC.to_owned(), spec);
        let saved = project
            .canvas_store
            .patch_component(&record.id, &req.id, patch)
            .await
            .map_err(Self::map_err)?;
        Self::emit_changed(&state, &project, &saved.id, saved.revision);
        Ok(Json(saved.into()))
    }
}

#[cfg(test)]
mod tests {
    use arris_engines::{CANVAS_DIR_NAME, CANVAS_FILE_EXT};
    use reqwest::StatusCode;
    use serde_json::json;
    use tempfile::TempDir;

    use crate::server::impl_api_routes::tests::{Harness, error_code, next_kind, run_id_of};
    use crate::server::{
        CANVAS_ADD_GAP, CANVAS_ADD_X, CANVAS_ADD_Y, CANVAS_KIND_CHART, CANVAS_KIND_QUERY,
        CANVAS_QUERY_W, ServerEventKind,
    };

    #[tokio::test]
    async fn canvas_crud_round_trip() {
        let h = Harness::start().await;
        let made = h.ok("canvas_create", json!({ "title": "Revenue" })).await;
        let id = made["id"].as_str().unwrap();
        assert_eq!(made["revision"], 0);
        let by_title = h.ok("canvas_get", json!({ "canvas": "Revenue" })).await;
        assert_eq!(by_title["id"], id);
        let saved = h
            .ok("canvas_save", json!({ "id": id, "doc": { "version": 1, "components": [1], "edges": [] }, "revision": 0 }))
            .await;
        assert_eq!(saved["revision"], 1);
        let renamed = h
            .ok("canvas_rename", json!({ "id": id, "title": "Sales" }))
            .await;
        assert_eq!(renamed["title"], "Sales");
        let list = h.ok("canvas_list", json!({})).await;
        assert_eq!(list[0]["componentCount"], 1);
        assert_eq!(list[0]["title"], "Sales");
        h.ok("canvas_delete", json!({ "id": id })).await;
        assert_eq!(h.ok("canvas_list", json!({})).await, json!([]));
        let gone = h.call("canvas_get", json!({ "canvas": id })).await;
        assert_eq!(
            error_code(gone).await,
            (StatusCode::NOT_FOUND, "canvas_not_found".into())
        );
    }

    #[tokio::test]
    async fn canvas_get_by_ambiguous_title_is_409() {
        let h = Harness::start().await;
        let a = h.ok("canvas_create", json!({ "title": "Revenue" })).await;
        let b = h.ok("canvas_create", json!({ "title": "Revenue" })).await;
        let resp = h.call("canvas_get", json!({ "canvas": "Revenue" })).await;
        let status = resp.status();
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["error"]["code"], "ambiguous");
        let msg = body["error"]["message"].as_str().unwrap();
        assert!(msg.contains(a["id"].as_str().unwrap()) && msg.contains(b["id"].as_str().unwrap()));
        let none = h.call("canvas_get", json!({ "canvas": "Nope" })).await;
        assert_eq!(
            error_code(none).await,
            (StatusCode::NOT_FOUND, "canvas_not_found".into())
        );
    }

    #[tokio::test]
    async fn canvas_from_other_project_is_404() {
        let h = Harness::start().await;
        let made = h.ok("canvas_create", json!({ "title": "Revenue" })).await;
        let other = TempDir::new().unwrap();
        let resp = h
            .call_at(other.path(), "canvas_get", json!({ "canvas": made["id"] }))
            .await;
        assert_eq!(
            error_code(resp).await,
            (StatusCode::NOT_FOUND, "canvas_not_found".into())
        );
    }

    #[tokio::test]
    async fn canvas_save_stale_revision_is_409() {
        let h = Harness::start().await;
        let made = h.ok("canvas_create", json!({ "title": "a" })).await;
        let id = made["id"].clone();
        h.ok(
            "canvas_save",
            json!({ "id": id, "doc": { "components": [], "edges": [] }, "revision": 0 }),
        )
        .await;
        let stale = h
            .call(
                "canvas_save",
                json!({ "id": id, "doc": { "components": [], "edges": [] }, "revision": 0 }),
            )
            .await;
        let status = stale.status();
        let body: serde_json::Value = stale.json().await.unwrap();
        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(body["error"]["code"], "conflict");
        assert!(body["error"]["message"].as_str().unwrap().contains('1'));
    }

    #[tokio::test]
    async fn canvas_save_malformed_doc_is_400() {
        let h = Harness::start().await;
        let made = h.ok("canvas_create", json!({ "title": "a" })).await;
        for doc in [json!(null), json!(5), json!({ "components": [] })] {
            let resp = h
                .call(
                    "canvas_save",
                    json!({ "id": made["id"], "doc": doc, "revision": 0 }),
                )
                .await;
            assert_eq!(
                error_code(resp).await,
                (StatusCode::BAD_REQUEST, "invalid_request".into())
            );
        }
    }

    #[tokio::test]
    async fn canvas_mutations_emit_canvas_changed() {
        let h = Harness::start().await;
        let mut events = h.state.events.subscribe();
        let made = h.ok("canvas_create", json!({ "title": "a" })).await;
        let event = next_kind(&mut events).await;
        assert_eq!(event.kind, ServerEventKind::CanvasChanged);
        assert_eq!(event.payload, json!({ "id": made["id"], "revision": 0 }));
        h.ok("canvas_rename", json!({ "id": made["id"], "title": "b" }))
            .await;
        assert_eq!(next_kind(&mut events).await.payload["revision"], 1);
        h.ok("canvas_delete", json!({ "id": made["id"] })).await;
        assert_eq!(
            next_kind(&mut events).await.kind,
            ServerEventKind::CanvasChanged
        );
    }

    #[tokio::test]
    async fn corrupt_canvas_get_is_store_failed() {
        let h = Harness::start().await;
        let good = h.ok("canvas_create", json!({ "title": "good" })).await;
        let project = h.state.env.project(h.project.path()).await.unwrap();
        let dir = project.read().await.arris_dir.join(CANVAS_DIR_NAME);
        let bad = uuid::Uuid::new_v4().to_string();
        std::fs::write(dir.join(format!("{bad}.{CANVAS_FILE_EXT}")), "{broken").unwrap();
        let resp = h.call("canvas_get", json!({ "canvas": bad })).await;
        let status = resp.status();
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body["error"]["code"], "store_failed");
        assert!(body["error"]["message"].as_str().unwrap().contains(&bad));
        let list = h.ok("canvas_list", json!({})).await;
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!(list[0]["id"], good["id"]);
        h.ok("canvas_delete", json!({ "id": bad })).await;
        assert!(!dir.join(format!("{bad}.{CANVAS_FILE_EXT}")).exists());
    }

    #[tokio::test]
    async fn canvas_add_from_run_appends_query() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        let run_id = run_id_of(&h, &cfg, "SELECT 1 AS n\nFROM (SELECT 1)", 10).await;
        let board = h.ok("canvas_create", json!({ "title": "B" })).await;
        let mut events = h.state.events.subscribe();
        let added = h
            .ok(
                "canvas_add",
                json!({ "canvas": "B", "source": { "runId": run_id } }),
            )
            .await;
        assert_eq!(added["canvas"]["revision"], 1);
        assert_eq!(added["canvas"]["componentCount"], 1);
        assert!(added.get("chartId").is_none());
        assert_eq!(
            next_kind(&mut events).await.kind,
            ServerEventKind::CanvasChanged
        );
        let got = h.ok("canvas_get", json!({ "canvas": board["id"] })).await;
        let query = &got["doc"]["components"][0];
        assert_eq!(query["id"], added["queryId"]);
        assert_eq!(query["kind"], CANVAS_KIND_QUERY);
        assert_eq!(query["connectionId"], cfg.id.to_string());
        assert_eq!(query["title"], "SELECT 1 AS n");
        assert_eq!(query["x"], CANVAS_ADD_X);
        assert_eq!(query["y"], CANVAS_ADD_Y);
        assert_eq!(query["w"], CANVAS_QUERY_W);
        assert_eq!(query["autoRun"], true);
    }

    #[tokio::test]
    async fn canvas_add_never_auto_runs_a_write() {
        let h = Harness::start().await;
        h.save_sqlite("local").await;
        let board = h.ok("canvas_create", json!({ "title": "B" })).await;
        let body = json!({ "canvas": board["id"],
                           "source": { "sql": "DELETE FROM t", "connection": "local" } });
        h.ok("canvas_add", body).await;
        let got = h.ok("canvas_get", json!({ "canvas": board["id"] })).await;
        assert_eq!(got["doc"]["components"][0]["autoRun"], false);
    }

    #[tokio::test]
    async fn canvas_add_with_chart_adds_bound_chart_and_edge() {
        let h = Harness::start().await;
        let cfg = h.save_sqlite("local").await;
        let board = h.ok("canvas_create", json!({ "title": "B" })).await;
        let spec = json!({ "kind": "bar", "xColumn": "k", "yColumns": ["n"] });
        let body = json!({ "canvas": board["id"], "title": "Totals", "chart": spec,
                           "source": { "sql": "SELECT 1", "connection": "local" } });
        let added = h.ok("canvas_add", body).await;
        let got = h.ok("canvas_get", json!({ "canvas": board["id"] })).await;
        let comps = got["doc"]["components"].as_array().unwrap();
        assert_eq!(comps.len(), 2);
        assert_eq!(comps[0]["title"], "Totals");
        assert_eq!(comps[0]["connectionId"], cfg.id.to_string());
        assert_eq!(comps[1]["id"], added["chartId"]);
        assert_eq!(comps[1]["kind"], CANVAS_KIND_CHART);
        assert_eq!(comps[1]["sourceQueryId"], added["queryId"]);
        assert_eq!(comps[1]["spec"], spec);
        let edge = &got["doc"]["edges"][0];
        assert_eq!(edge["source"], added["queryId"]);
        assert_eq!(edge["target"], added["chartId"]);
    }

    #[tokio::test]
    async fn canvas_chart_redraws_and_remove_drops_object_with_its_edge() {
        let h = Harness::start().await;
        h.save_sqlite("local").await;
        let board = h.ok("canvas_create", json!({ "title": "B" })).await;
        let spec = json!({ "kind": "bar", "xColumn": "k", "yColumns": ["n"] });
        let body = json!({ "canvas": "B", "chart": spec,
                           "source": { "sql": "SELECT 1", "connection": "local" } });
        let added = h.ok("canvas_add", body).await;
        let (query, chart) = (&added["queryId"], &added["chartId"]);

        let line = json!({ "kind": "line", "xColumn": "day", "yColumns": ["a", "b"] });
        h.ok(
            "canvas_chart",
            json!({ "canvas": "B", "id": chart, "spec": line }),
        )
        .await;
        let got = h.ok("canvas_get", json!({ "canvas": board["id"] })).await;
        assert_eq!(got["doc"]["components"][1]["spec"], line);
        let not_chart = json!({ "canvas": "B", "id": query, "spec": line });
        let (status, _) = error_code(h.call("canvas_chart", not_chart).await).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);

        h.ok("canvas_remove", json!({ "canvas": "B", "id": query }))
            .await;
        let got = h.ok("canvas_get", json!({ "canvas": board["id"] })).await;
        assert_eq!(got["doc"]["components"].as_array().unwrap().len(), 1);
        assert_eq!(got["doc"]["edges"], json!([]));
        let gone = json!({ "canvas": "B", "id": query });
        let (status, code) = error_code(h.call("canvas_remove", gone).await).await;
        assert_eq!(
            (status, code.as_str()),
            (StatusCode::NOT_FOUND, "canvas_not_found")
        );
    }

    #[tokio::test]
    async fn canvas_add_places_below_existing() {
        let h = Harness::start().await;
        h.save_sqlite("local").await;
        let board = h.ok("canvas_create", json!({ "title": "B" })).await;
        let low =
            json!({ "id": "s", "kind": "sticky", "x": 0, "y": 500, "w": 10, "h": 100, "z": 7 });
        let doc = json!({ "version": 1, "components": [low], "edges": [] });
        h.ok(
            "canvas_save",
            json!({ "id": board["id"], "doc": doc, "revision": 0 }),
        )
        .await;
        let body = json!({ "canvas": "B", "source": { "sql": "SELECT 1", "connection": "local" } });
        h.ok("canvas_add", body).await;
        let got = h.ok("canvas_get", json!({ "canvas": "B" })).await;
        let added = &got["doc"]["components"][1];
        assert_eq!(added["y"], 500.0 + 100.0 + CANVAS_ADD_GAP);
        assert_eq!(added["z"], 8.0);
    }

    #[tokio::test]
    async fn canvas_add_unknown_connection_is_404() {
        let h = Harness::start().await;
        h.ok("canvas_create", json!({ "title": "B" })).await;
        let body = json!({ "canvas": "B", "source": { "sql": "SELECT 1", "connection": "nope" } });
        let (status, code) = error_code(h.call("canvas_add", body).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(code, "connection_not_found");
        let body = json!({ "canvas": "B", "source": { "runId": "missing" } });
        let (status, code) = error_code(h.call("canvas_add", body).await).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(code, "run_not_found");
    }
}
