use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use arris_engines::dbt::{
    ColumnLineageGraph, LineageGraph, ScanError, ScannedNode, ScannedProject,
};
use arris_engines::sqlmesh::{ScannedSqlMeshModel, ScannedSqlMeshProject, SqlMeshError};
use arris_engines::{DbtEngine, SqlMeshEngine};
use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};

use super::impl_api_routes::{ApiResult, ApiState, Body};
use super::{
    AnalyticsDirRequest, AnalyticsLineageRequest, AnalyticsLineageResponse, AnalyticsModelRequest,
    ApiError, ApiRoutes, DBT_LINEAGE_ROUTE, DBT_MODEL_KIND, DBT_MODEL_ROUTE, DBT_MODELS_ROUTE,
    DbtModelDetail, DbtModelSummary, DbtModelsResponse, SQLMESH_LINEAGE_ROUTE, SQLMESH_MODEL_ROUTE,
    SQLMESH_MODELS_ROUTE, ServerState, SqlMeshModelDetail, SqlMeshModelSummary,
    SqlMeshModelsResponse,
};

/// `dbt_*` / `sqlmesh_*` read handlers: models, one model and lineage from file scans.
pub struct AnalyticsRoutes;

impl AnalyticsRoutes {
    pub fn router() -> Router<Arc<ServerState>> {
        Router::new()
            .route(DBT_MODELS_ROUTE, post(Self::dbt_models))
            .route(DBT_MODEL_ROUTE, post(Self::dbt_model))
            .route(DBT_LINEAGE_ROUTE, post(Self::dbt_lineage))
            .route(SQLMESH_MODELS_ROUTE, post(Self::sqlmesh_models))
            .route(SQLMESH_MODEL_ROUTE, post(Self::sqlmesh_model))
            .route(SQLMESH_LINEAGE_ROUTE, post(Self::sqlmesh_lineage))
    }

    /// Canonical `root/dir`; `..` past the root and symlinks out of it are refused.
    pub fn resolve_dir(root: &Path, dir: Option<&str>) -> Result<PathBuf, ApiError> {
        let dir = Path::new(dir.unwrap_or_default());
        if Self::climbs_out(dir) {
            return Err(ApiError::DirOutsideProject(dir.display().to_string()));
        }
        let root = root
            .canonicalize()
            .map_err(|_| ApiError::DirNotFound(root.display().to_string()))?;
        let wanted = root.join(dir);
        let resolved = wanted
            .canonicalize()
            .map_err(|_| ApiError::DirNotFound(wanted.display().to_string()))?;
        if !resolved.starts_with(&root) {
            return Err(ApiError::DirOutsideProject(dir.display().to_string()));
        }
        Ok(resolved)
    }

    fn climbs_out(dir: &Path) -> bool {
        let mut depth = 0usize;
        for part in dir.components() {
            match part {
                Component::ParentDir if depth == 0 => return true,
                Component::ParentDir => depth -= 1,
                Component::Normal(_) => depth += 1,
                _ => {}
            }
        }
        false
    }

    async fn blocking<T: Send + 'static>(
        work: impl FnOnce() -> T + Send + 'static,
    ) -> Result<T, ApiError> {
        tokio::task::spawn_blocking(work)
            .await
            .map_err(|e| ApiError::ProjectScan(e.to_string()))
    }

    async fn project_dir(
        state: &ServerState,
        headers: &HeaderMap,
        dir: Option<&str>,
    ) -> Result<PathBuf, ApiError> {
        let root = ApiRoutes::project_root(state, headers).await?;
        Self::resolve_dir(&root, dir)
    }

    fn relative(dir: &Path, file: &str) -> String {
        Path::new(file)
            .strip_prefix(dir)
            .map_or_else(|_| file.to_owned(), |p| p.display().to_string())
    }

    fn read_sql(file: &str) -> Result<String, ApiError> {
        fs::read_to_string(file).map_err(|e| ApiError::ProjectScan(format!("{file}: {e}")))
    }

    fn downstream_of<'a>(
        id: &str,
        deps: impl Iterator<Item = (&'a str, &'a [String])>,
    ) -> Vec<String> {
        deps.filter(|(_, on)| on.iter().any(|d| d == id))
            .map(|(other, _)| other.to_owned())
            .collect()
    }

    /// `start` plus every node reachable upstream (or downstream) along edges.
    fn reachable(graph: &LineageGraph, start: &str, upstream: bool) -> HashSet<String> {
        let mut seen = HashSet::from([start.to_owned()]);
        let mut queue = VecDeque::from([start.to_owned()]);
        while let Some(at) = queue.pop_front() {
            for edge in &graph.edges {
                let (here, next) = if upstream {
                    (&edge.to, &edge.from)
                } else {
                    (&edge.from, &edge.to)
                };
                if *here == at && seen.insert(next.clone()) {
                    queue.push_back(next.clone());
                }
            }
        }
        seen
    }

    /// The model's ancestors and descendants with the edges among them.
    fn neighborhood(graph: LineageGraph, id: &str) -> LineageGraph {
        let mut keep = Self::reachable(&graph, id, true);
        keep.extend(Self::reachable(&graph, id, false));
        LineageGraph {
            nodes: graph
                .nodes
                .into_iter()
                .filter(|n| keep.contains(&n.id))
                .collect(),
            edges: graph
                .edges
                .into_iter()
                .filter(|e| keep.contains(&e.from) && keep.contains(&e.to))
                .collect(),
        }
    }

    /// Only the columns that feed `model.column`, walking edges upstream.
    fn column_path(graph: ColumnLineageGraph, model: &str, column: &str) -> ColumnLineageGraph {
        let start = (model.to_owned(), column.to_owned());
        let mut seen = HashSet::from([start.clone()]);
        let mut queue = VecDeque::from([start]);
        while let Some((at_model, at_column)) = queue.pop_front() {
            for edge in &graph.edges {
                if edge.to_model == at_model && edge.to_column == at_column {
                    let from = (edge.from_model.clone(), edge.from_column.clone());
                    if seen.insert(from.clone()) {
                        queue.push_back(from);
                    }
                }
            }
        }
        let fed = |m: &str, c: &str| seen.contains(&(m.to_owned(), c.to_owned()));
        let mut nodes = graph.nodes;
        for node in &mut nodes {
            node.columns.retain(|c| fed(&node.model_id, c));
        }
        nodes.retain(|n| !n.columns.is_empty());
        ColumnLineageGraph {
            nodes,
            edges: graph
                .edges
                .into_iter()
                .filter(|e| fed(&e.to_model, &e.to_column))
                .collect(),
        }
    }
}

// dbt: everything comes from `scan_project` plus cached `target/compiled` SQL.
impl AnalyticsRoutes {
    async fn dbt_scan(
        state: &ServerState,
        headers: &HeaderMap,
        dir: Option<&str>,
    ) -> Result<(PathBuf, ScannedProject), ApiError> {
        let dir = Self::project_dir(state, headers, dir).await?;
        let scan_dir = dir.clone();
        match Self::blocking(move || DbtEngine::new().scan_project(&scan_dir)).await? {
            Ok(project) => Ok((dir, project)),
            Err(ScanError::ProjectFileMissing(_)) => {
                Err(ApiError::DbtProjectNotFound(dir.display().to_string()))
            }
            Err(e) => Err(ApiError::ProjectScan(e.to_string())),
        }
    }

    fn dbt_summary(dir: &Path, node: &ScannedNode) -> DbtModelSummary {
        DbtModelSummary {
            unique_id: node.unique_id.clone(),
            name: node.name.clone(),
            schema: node.schema.clone(),
            materialized: node.materialized.clone(),
            depends_on: node.depends_on.clone(),
            path: Self::relative(dir, &node.file_path),
        }
    }

    fn dbt_find<'a>(project: &'a ScannedProject, name: &str) -> Result<&'a ScannedNode, ApiError> {
        project
            .nodes
            .iter()
            .find(|n| n.kind == DBT_MODEL_KIND && (n.name == name || n.unique_id == name))
            .ok_or_else(|| ApiError::ModelNotFound(name.to_owned()))
    }

    fn dbt_graph(project: &ScannedProject) -> LineageGraph {
        let kinds: HashMap<&str, &str> = project
            .nodes
            .iter()
            .map(|n| (n.unique_id.as_str(), n.kind.as_str()))
            .collect();
        let deps: Vec<(String, Vec<String>)> = project
            .nodes
            .iter()
            .map(|n| (n.unique_id.clone(), n.depends_on.clone()))
            .collect();
        LineageGraph::build(&deps, |id| {
            kinds.get(id).copied().unwrap_or_default().to_owned()
        })
    }

    async fn dbt_models(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<AnalyticsDirRequest>,
    ) -> ApiResult<DbtModelsResponse> {
        let Json(req) = body?;
        let (dir, project) = Self::dbt_scan(&state, &headers, req.dir.as_deref()).await?;
        let mut models: Vec<DbtModelSummary> = project
            .nodes
            .iter()
            .filter(|n| n.kind == DBT_MODEL_KIND)
            .map(|n| Self::dbt_summary(&dir, n))
            .collect();
        models.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(Json(DbtModelsResponse {
            project_name: project.name,
            root: dir.display().to_string(),
            models,
        }))
    }

    async fn dbt_model(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<AnalyticsModelRequest>,
    ) -> ApiResult<DbtModelDetail> {
        let Json(req) = body?;
        let (dir, project) = Self::dbt_scan(&state, &headers, req.dir.as_deref()).await?;
        let node = Self::dbt_find(&project, &req.name)?;
        let deps = project
            .nodes
            .iter()
            .map(|n| (n.unique_id.as_str(), n.depends_on.as_slice()));
        Ok(Json(DbtModelDetail {
            summary: Self::dbt_summary(&dir, node),
            description: node.description.clone(),
            raw_sql: Self::read_sql(&node.file_path)?,
            compiled_sql: DbtEngine::new().compiled_sql(dir.clone(), &project.name, &node.name),
            columns: node.columns.clone(),
            upstream: node.depends_on.clone(),
            downstream: Self::downstream_of(&node.unique_id, deps),
        }))
    }

    async fn dbt_lineage(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<AnalyticsLineageRequest>,
    ) -> ApiResult<AnalyticsLineageResponse> {
        let Json(req) = body?;
        let (dir, project) = Self::dbt_scan(&state, &headers, req.dir.as_deref()).await?;
        let graph = Self::dbt_graph(&project);
        let Some(name) = req.name.as_deref() else {
            return Ok(Json(AnalyticsLineageResponse {
                graph,
                columns: None,
            }));
        };
        let id = Self::dbt_find(&project, name)?.unique_id.clone();
        let columns = match req.column.as_deref() {
            Some(column) => {
                let ancestors = Self::reachable(&graph, &id, true).into_iter().collect();
                let full = DbtEngine::new()
                    .cached_column_lineage(dir, ancestors, project.name.clone(), &project.nodes)
                    .map_err(|e| ApiError::ProjectScan(e.to_string()))?;
                Some(Self::column_path(full, &id, column))
            }
            None => None,
        };
        Ok(Json(AnalyticsLineageResponse {
            graph: Self::neighborhood(graph, &id),
            columns,
        }))
    }
}

// sqlmesh: models are keyed by their fully qualified name.
impl AnalyticsRoutes {
    async fn sqlmesh_scan(
        state: &ServerState,
        headers: &HeaderMap,
        dir: Option<&str>,
    ) -> Result<(PathBuf, ScannedSqlMeshProject), ApiError> {
        let dir = Self::project_dir(state, headers, dir).await?;
        let scan_dir = dir.clone();
        match Self::blocking(move || SqlMeshEngine::new().scan_project(&scan_dir)).await? {
            Ok(project) => Ok((dir, project)),
            Err(SqlMeshError::ConfigMissing(_) | SqlMeshError::NotSqlMeshProject(_)) => {
                Err(ApiError::SqlMeshProjectNotFound(dir.display().to_string()))
            }
            Err(e) => Err(ApiError::ProjectScan(e.to_string())),
        }
    }

    fn sqlmesh_summary(dir: &Path, model: &ScannedSqlMeshModel) -> SqlMeshModelSummary {
        SqlMeshModelSummary {
            name: model.name.clone(),
            kind: model.kind.clone(),
            cron: model.cron.clone(),
            owner: model.owner.clone(),
            depends_on: model.depends_on.clone(),
            path: Self::relative(dir, &model.file_path),
        }
    }

    fn sqlmesh_find<'a>(
        project: &'a ScannedSqlMeshProject,
        name: &str,
    ) -> Result<&'a ScannedSqlMeshModel, ApiError> {
        project
            .models
            .iter()
            .find(|m| m.name == name)
            .ok_or_else(|| ApiError::ModelNotFound(name.to_owned()))
    }

    fn sqlmesh_graph(project: &ScannedSqlMeshProject) -> LineageGraph {
        let kinds: HashMap<&str, &str> = project
            .models
            .iter()
            .map(|m| (m.name.as_str(), m.kind.as_str()))
            .collect();
        let deps: Vec<(String, Vec<String>)> = project
            .models
            .iter()
            .map(|m| (m.name.clone(), m.depends_on.clone()))
            .collect();
        LineageGraph::build(&deps, |id| {
            kinds.get(id).copied().unwrap_or_default().to_owned()
        })
    }

    async fn sqlmesh_models(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<AnalyticsDirRequest>,
    ) -> ApiResult<SqlMeshModelsResponse> {
        let Json(req) = body?;
        let (dir, project) = Self::sqlmesh_scan(&state, &headers, req.dir.as_deref()).await?;
        Ok(Json(SqlMeshModelsResponse {
            root: dir.display().to_string(),
            models: project
                .models
                .iter()
                .map(|m| Self::sqlmesh_summary(&dir, m))
                .collect(),
        }))
    }

    async fn sqlmesh_model(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<AnalyticsModelRequest>,
    ) -> ApiResult<SqlMeshModelDetail> {
        let Json(req) = body?;
        let (dir, project) = Self::sqlmesh_scan(&state, &headers, req.dir.as_deref()).await?;
        let model = Self::sqlmesh_find(&project, &req.name)?;
        let deps = project
            .models
            .iter()
            .map(|m| (m.name.as_str(), m.depends_on.as_slice()));
        Ok(Json(SqlMeshModelDetail {
            summary: Self::sqlmesh_summary(&dir, model),
            description: model.description.clone(),
            raw_sql: Self::read_sql(&model.file_path)?,
            columns: model.columns.clone(),
            upstream: model.depends_on.clone(),
            downstream: Self::downstream_of(&model.name, deps),
        }))
    }

    async fn sqlmesh_lineage(
        State(state): ApiState,
        headers: HeaderMap,
        body: Body<AnalyticsLineageRequest>,
    ) -> ApiResult<AnalyticsLineageResponse> {
        let Json(req) = body?;
        let (dir, project) = Self::sqlmesh_scan(&state, &headers, req.dir.as_deref()).await?;
        let graph = Self::sqlmesh_graph(&project);
        let Some(name) = req.name.clone() else {
            return Ok(Json(AnalyticsLineageResponse {
                graph,
                columns: None,
            }));
        };
        let name = Self::sqlmesh_find(&project, &name)?.name.clone();
        let columns = match req.column {
            Some(column) => {
                let ancestors = Self::reachable(&graph, &name, true).into_iter().collect();
                let models = project.models.clone();
                // Rendering shells out to sqlmesh; models it cannot render are skipped.
                let full = Self::blocking(move || {
                    SqlMeshEngine::new().column_lineage(dir, ancestors, None, &models)
                })
                .await?;
                Some(Self::column_path(full, &name, &column))
            }
            None => None,
        };
        Ok(Json(AnalyticsLineageResponse {
            graph: Self::neighborhood(graph, &name),
            columns,
        }))
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use reqwest::StatusCode;
    use serde_json::{Value, json};

    use super::AnalyticsRoutes;
    use crate::server::ApiError;
    use crate::server::impl_api_routes::tests::{Harness, error_code};

    fn write(root: &Path, rel: &str, text: &str) {
        let path = root.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    /// stg_orders -> orders -> customers, with orders compiled for column lineage.
    fn dbt_fixture(root: &Path) {
        write(
            root,
            "dbt_project.yml",
            "name: jaffle\nversion: '1.0'\nprofile: dev\nmodel-paths: [models]\n",
        );
        write(root, "models/stg_orders.sql", "SELECT 1 AS id, 2 AS amount");
        write(
            root,
            "models/orders.sql",
            "{{ config(materialized='table') }}\nSELECT id, amount FROM {{ ref('stg_orders') }}",
        );
        write(
            root,
            "models/customers.sql",
            "SELECT id FROM {{ ref('orders') }}",
        );
        write(
            root,
            "target/compiled/jaffle/models/stg_orders.sql",
            "SELECT 1 AS id, 2 AS amount",
        );
        write(
            root,
            "target/compiled/jaffle/models/orders.sql",
            "SELECT id, amount FROM analytics.stg_orders",
        );
    }

    fn sqlmesh_fixture(root: &Path) {
        write(
            root,
            "config.yaml",
            "gateways:\n  local:\n    connection:\n      type: duckdb\nmodel_defaults:\n  dialect: duckdb\n",
        );
        write(
            root,
            "models/stg_orders.sql",
            "MODEL (name app.stg_orders, kind FULL);\nSELECT 1 AS id",
        );
        write(
            root,
            "models/orders.sql",
            "MODEL (name app.orders, kind FULL);\nSELECT id FROM app.stg_orders",
        );
    }

    fn ids(graph: &Value, key: &str) -> Vec<String> {
        let mut out: Vec<String> = graph[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n["id"].as_str().unwrap().to_owned())
            .collect();
        out.sort();
        out
    }

    #[tokio::test]
    async fn dbt_models_lists_fixture_models() {
        let h = Harness::start().await;
        dbt_fixture(h.project.path());
        let out = h.ok("dbt_models", json!({})).await;
        assert_eq!(out["projectName"], "jaffle");
        let names: Vec<&str> = out["models"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["customers", "orders", "stg_orders"]);
        let orders = &out["models"][1];
        assert_eq!(orders["materialized"], "table");
        assert_eq!(orders["path"], "models/orders.sql");
        assert!(orders.get("rawSql").is_none());
    }

    #[tokio::test]
    async fn dbt_model_returns_sql_and_neighbors() {
        let h = Harness::start().await;
        dbt_fixture(h.project.path());
        let out = h.ok("dbt_model", json!({ "name": "orders" })).await;
        assert!(
            out["rawSql"]
                .as_str()
                .unwrap()
                .contains("ref('stg_orders')")
        );
        assert_eq!(
            out["compiledSql"],
            "SELECT id, amount FROM analytics.stg_orders"
        );
        assert_eq!(out["upstream"], json!(["model.jaffle.stg_orders"]));
        assert_eq!(out["downstream"], json!(["model.jaffle.customers"]));
        let missing = h.call("dbt_model", json!({ "name": "nope" })).await;
        assert_eq!(
            error_code(missing).await,
            (StatusCode::NOT_FOUND, "model_not_found".into())
        );
    }

    #[tokio::test]
    async fn dbt_lineage_whole_project_and_single_model() {
        let h = Harness::start().await;
        dbt_fixture(h.project.path());
        write(h.project.path(), "models/other.sql", "SELECT 3 AS x");
        let all = h.ok("dbt_lineage", json!({})).await;
        assert_eq!(ids(&all["graph"], "nodes").len(), 4);
        let one = h.ok("dbt_lineage", json!({ "name": "stg_orders" })).await;
        assert_eq!(
            ids(&one["graph"], "nodes"),
            [
                "model.jaffle.customers",
                "model.jaffle.orders",
                "model.jaffle.stg_orders"
            ]
        );
        assert_eq!(one["graph"]["edges"].as_array().unwrap().len(), 2);
        assert!(one.get("columns").is_none());
    }

    #[tokio::test]
    async fn dbt_column_lineage_for_column() {
        let h = Harness::start().await;
        dbt_fixture(h.project.path());
        let out = h
            .ok(
                "dbt_lineage",
                json!({ "name": "orders", "column": "amount" }),
            )
            .await;
        let edges = out["columns"]["edges"].as_array().unwrap();
        assert_eq!(edges.len(), 1, "{edges:?}");
        assert_eq!(edges[0]["fromModel"], "model.jaffle.stg_orders");
        assert_eq!(edges[0]["fromColumn"], "amount");
        assert_eq!(edges[0]["toColumn"], "amount");
    }

    #[tokio::test]
    async fn dir_outside_project_is_403() {
        let h = Harness::start().await;
        let out = h.call("dbt_models", json!({ "dir": "../../etc" })).await;
        assert_eq!(
            error_code(out).await,
            (StatusCode::FORBIDDEN, "forbidden".into())
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn symlink_escape_is_403() {
        let h = Harness::start().await;
        let outside = tempfile::TempDir::new().unwrap();
        dbt_fixture(outside.path());
        std::os::unix::fs::symlink(outside.path(), h.project.path().join("escape")).unwrap();
        let out = h.call("dbt_models", json!({ "dir": "escape" })).await;
        assert_eq!(
            error_code(out).await,
            (StatusCode::FORBIDDEN, "forbidden".into())
        );
    }

    #[tokio::test]
    async fn missing_dbt_project_is_404_with_path() {
        let h = Harness::start().await;
        let out = h.call("dbt_models", json!({})).await;
        assert_eq!(out.status(), StatusCode::NOT_FOUND);
        let body: Value = out.json().await.unwrap();
        assert_eq!(body["error"]["code"], "dbt_project_not_found");
        let message = body["error"]["message"].as_str().unwrap();
        let root = h.project.path().canonicalize().unwrap();
        assert!(message.contains(root.to_str().unwrap()), "{message}");
        assert!(message.contains("--dir"), "{message}");
    }

    #[tokio::test]
    async fn dbt_project_in_subfolder_via_dir() {
        let h = Harness::start().await;
        dbt_fixture(&h.project.path().join("analytics/dbt"));
        let out = h.ok("dbt_models", json!({ "dir": "analytics/dbt" })).await;
        assert_eq!(out["models"].as_array().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn sqlmesh_models_and_lineage() {
        let h = Harness::start().await;
        sqlmesh_fixture(h.project.path());
        let out = h.ok("sqlmesh_models", json!({})).await;
        let names: Vec<&str> = out["models"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["app.orders", "app.stg_orders"]);
        let model = h.ok("sqlmesh_model", json!({ "name": "app.orders" })).await;
        assert_eq!(model["upstream"], json!(["app.stg_orders"]));
        assert!(model["rawSql"].as_str().unwrap().contains("MODEL"));
        let lineage = h
            .ok("sqlmesh_lineage", json!({ "name": "app.orders" }))
            .await;
        assert_eq!(
            ids(&lineage["graph"], "nodes"),
            ["app.orders", "app.stg_orders"]
        );
        let missing = h.call("sqlmesh_models", json!({ "dir": "models" })).await;
        assert_eq!(
            error_code(missing).await,
            (StatusCode::NOT_FOUND, "sqlmesh_project_not_found".into())
        );
    }

    #[test]
    fn climbs_out_only_past_the_root() {
        assert!(AnalyticsRoutes::climbs_out(Path::new("../x")));
        assert!(AnalyticsRoutes::climbs_out(Path::new("a/../../x")));
        assert!(!AnalyticsRoutes::climbs_out(Path::new("a/../b")));
        assert!(matches!(
            AnalyticsRoutes::resolve_dir(Path::new("/tmp"), Some("../etc")),
            Err(ApiError::DirOutsideProject(_))
        ));
    }
}
