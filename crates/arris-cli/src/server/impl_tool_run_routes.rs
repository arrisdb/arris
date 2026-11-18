use std::sync::Arc;

use arris_engines::{JsonCollectionStore, ToolRunRecord};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use uuid::Uuid;

use super::impl_api_routes::{ApiResult, ApiState, Body};
use super::{
    ApiError, ApiRoutes, ServerEventKind, ServerState, TOOL_RUN_GET_ROUTE,
    TOOL_RUN_LIST_DEFAULT_LIMIT, TOOL_RUN_LIST_ROUTE, TOOL_RUN_RECORD_ROUTE, ToolRunIdPayload,
    ToolRunIdRequest, ToolRunListRequest, ToolRunMeta, ToolRunRecordRequest,
};

/// `tool_run_*` handlers: the per-project log of native dbt / sqlmesh runs.
pub struct ToolRunRoutes;

impl ToolRunRoutes {
    pub fn router() -> Router<Arc<ServerState>> {
        Router::new()
            .route(TOOL_RUN_RECORD_ROUTE, post(Self::tool_run_record))
            .route(TOOL_RUN_LIST_ROUTE, post(Self::tool_run_list))
            .route(TOOL_RUN_GET_ROUTE, post(Self::tool_run_get))
    }

    async fn tool_run_record(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<ToolRunRecordRequest>,
    ) -> ApiResult<ToolRunIdPayload> {
        let Json(req) = body?;
        let mut record = req.record;
        if record.id.is_empty() {
            record.id = Uuid::new_v4().to_string();
        }
        let id = record.id.clone();
        let project = ApiRoutes::project(&state, &headers).await?;
        let project = project.read().await;
        project.tool_run_store.append(record).await?;
        let payload = ToolRunIdPayload { id: id.clone() };
        ApiRoutes::emit(&state, ServerEventKind::ToolRunsChanged, &project, payload);
        Ok(Json(ToolRunIdPayload { id }))
    }

    async fn tool_run_list(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<ToolRunListRequest>,
    ) -> ApiResult<Vec<ToolRunMeta>> {
        let Json(req) = body?;
        let project = ApiRoutes::project(&state, &headers).await?;
        let all = project.read().await.tool_run_store.load().await?;
        let limit = req.limit.unwrap_or(TOOL_RUN_LIST_DEFAULT_LIMIT);
        Ok(Json(
            all.into_iter()
                .rev()
                .filter(|r| req.tool.is_none_or(|tool| r.tool == tool))
                .take(limit)
                .map(ToolRunMeta::from)
                .collect(),
        ))
    }

    async fn tool_run_get(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<ToolRunIdRequest>,
    ) -> ApiResult<ToolRunRecord> {
        let Json(req) = body?;
        let project = ApiRoutes::project(&state, &headers).await?;
        let found = project.read().await.tool_run_store.get(&req.id).await?;
        Ok(Json(found.ok_or(ApiError::ToolRunNotFound(req.id))?))
    }
}

#[cfg(test)]
mod tests {
    use reqwest::StatusCode;
    use serde_json::{Value, json};

    use crate::server::ServerEventKind;
    use crate::server::impl_api_routes::tests::{Harness, error_code, next_kind};

    fn record(tool: &str, tail: &str) -> Value {
        json!({ "record": {
            "tool": tool, "args": ["run"], "dir": ".", "startedAt": "2026-10-26T00:00:00Z",
            "finishedAt": "2026-10-26T00:00:01Z", "exitCode": 1, "outputTail": tail,
            "summary": { "success": 1, "error": 1, "skipped": 0, "warn": 0, "failed": ["model.a.b"] }
        }})
    }

    #[tokio::test]
    async fn tool_run_list_omits_output() {
        let h = Harness::start().await;
        let mut events = h.state.events.subscribe();
        let made = h.ok("tool_run_record", record("dbt", "SECRET LINE")).await;
        let id = made["id"].as_str().unwrap().to_owned();
        assert!(!id.is_empty());
        let event = next_kind(&mut events).await;
        assert_eq!(event.kind, ServerEventKind::ToolRunsChanged);
        assert_eq!(event.payload["id"], id.as_str());
        h.ok("tool_run_record", record("sqlmesh", "plan")).await;

        let dbt = h.ok("tool_run_list", json!({ "tool": "dbt" })).await;
        let rows = dbt.as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], id.as_str());
        assert_eq!(rows[0]["summary"]["failed"], json!(["model.a.b"]));
        assert!(rows[0].get("outputTail").is_none());
        assert!(!dbt.to_string().contains("SECRET"));

        let all = h.ok("tool_run_list", json!({})).await;
        assert_eq!(all[0]["tool"], "sqlmesh", "newest first");
        let full = h.ok("tool_run_get", json!({ "id": id })).await;
        assert_eq!(full["outputTail"], "SECRET LINE");
        let missing = h.call("tool_run_get", json!({ "id": "nope" })).await;
        assert_eq!(
            error_code(missing).await,
            (StatusCode::NOT_FOUND, "tool_run_not_found".into())
        );
    }
}
