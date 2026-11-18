use std::path::PathBuf;

use arris_engines::dbt::{ColumnLineageGraph, DbtColumnDoc, LineageGraph};
use arris_engines::sqlmesh::SqlMeshColumnDoc;
use arris_engines::{
    CanvasCellSpec, CanvasSummary, ConnectionConfig, ConnectionPrefill, DatabaseKind,
    PersistedConsoleTab, PersistedPaneLayout, PersistedPinnedQuery, QueryLanguage, QueryResult,
    RunRecord, RunSource, ToolKind, ToolRunRecord, ToolRunSummary,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::REDACTED;

/// Discovery record written to `SERVER_INFO_FILE` so CLI clients can reach the server.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerInfo {
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub version: String,
}

impl std::fmt::Debug for ServerInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ServerInfo")
            .field("pid", &self.pid)
            .field("port", &self.port)
            .field("token", &REDACTED)
            .field("version", &self.version)
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerEventKind {
    HistoryChanged,
    PinsChanged,
    ConnectionsChanged,
    ConnectionRequestResolved,
    CanvasChanged,
    CanvasCellIngested,
    ToolRunsChanged,
    QueryOpenRequested,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServerEvent {
    pub kind: ServerEventKind,
    pub project: Option<PathBuf>,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HealthResponse {
    pub version: String,
    pub token_ok: bool,
}

/// Query of the `GET /?token=&next=` browser login link.
#[derive(Debug, Clone, Deserialize)]
pub struct TokenQuery {
    pub token: Option<String>,
    pub next: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiErrorCode {
    MissingProject,
    InvalidProject,
    InvalidRequest,
    ConnectionNotFound,
    RunNotFound,
    PinNotFound,
    ResultNotCached,
    ConnectionFailed,
    QueryFailed,
    StoreFailed,
    ConnectionRequestNotFound,
    Forbidden,
    Conflict,
    Ambiguous,
    CanvasNotFound,
    RouteNotFound,
    DirNotFound,
    DbtProjectNotFound,
    SqlmeshProjectNotFound,
    ModelNotFound,
    ToolRunNotFound,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiErrorDetail {
    pub code: ApiErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApiErrorBody {
    pub error: ApiErrorDetail,
}

/// `{}` response for commands with nothing to return.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EmptyResponse {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OkResponse {
    pub ok: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSaveRequest {
    pub config: ConnectionConfig,
    /// Connection request this save resolves as `Saved`.
    pub request_id: Option<String>,
}

/// Tests either an unsaved `config` or a saved `connection` (id or name).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionTestRequest {
    pub config: Option<ConnectionConfig>,
    pub connection: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionRefRequest {
    pub connection: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaListRequest {
    pub connection: String,
    pub schema: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ObjectDefinitionRequest {
    pub connection: String,
    pub object: arris_engines::ObjectRef,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TableBrowseQueryRequest {
    pub connection: String,
    pub table: arris_engines::TableRef,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRunRequest {
    pub connection: String,
    pub sql: String,
    pub limit: Option<u32>,
    pub source: Option<RunSource>,
    pub language: Option<QueryLanguage>,
    pub query_id: Option<String>,
}

/// A results-grid fetch (page, sort, count): runs like a query but is not a history entry.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryPageRequest {
    pub connection: String,
    pub sql: String,
    pub language: Option<QueryLanguage>,
    pub page_size: Option<u32>,
    pub page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryRunResponse {
    pub run: RunRecord,
    pub result: QueryResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryOpenRequest {
    pub connection: String,
    pub sql: String,
    pub limit: Option<u32>,
}

/// `run` is set when the SQL was read-only and already ran; writes wait for the user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryOpenResponse {
    pub opened: bool,
    pub run: Option<QueryRunResponse>,
}

/// A query waiting to appear in a browser console tab.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHandoff {
    pub id: String,
    pub connection_id: String,
    pub sql: String,
    pub run_id: Option<String>,
}

/// The project's open tabs and pane layout, shared with the desktop app.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceResponse {
    pub tabs: Vec<PersistedConsoleTab>,
    pub pane_layout: PersistedPaneLayout,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceTabsSaveRequest {
    pub tabs: Vec<PersistedConsoleTab>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceLayoutSaveRequest {
    pub layout: PersistedPaneLayout,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HistoryListRequest {
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged, rename_all_fields = "camelCase")]
pub enum PinAddRequest {
    /// `title` defaults to the run's SQL.
    FromRun {
        run_id: String,
        title: Option<String>,
    },
    Manual {
        title: String,
        sql: String,
        connection: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PinRemoveRequest {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunIdRequest {
    pub run_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPageRequest {
    pub run_id: String,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunGetResponse {
    pub run: RunRecord,
    pub cached: bool,
}

/// The full pin list, as the shared pins pane saves it after any edit.
#[derive(Debug, Clone, Deserialize)]
pub struct PinSaveRequest {
    pub queries: Vec<PersistedPinnedQuery>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PinRenameRequest {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ConnectionRequestStatus {
    Pending,
    Saved { connection_id: Uuid, name: String },
    Cancelled,
}

/// A pending browser form, bound to the canonical project root it was created for.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRequest {
    pub id: String,
    pub project: PathBuf,
    pub kind: Option<DatabaseKind>,
    /// Non-secret fields from a dbt profile or sqlmesh gateway, shown in the form.
    pub prefill: Option<ConnectionPrefill>,
    pub status: ConnectionRequestStatus,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConnectionRequestCreateRequest {
    pub kind: Option<DatabaseKind>,
    #[serde(default)]
    pub prefill: Option<ConnectionPrefill>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionRequestCreateResponse {
    pub id: String,
    /// Relative UI path of the form.
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionRequestIdRequest {
    pub id: String,
}

/// `ConnectionRequestResolved` payload; never carries config or secrets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionRequestResolvedPayload {
    pub id: String,
    pub status: ConnectionRequestStatus,
}

/// Frontend build embedded at compile time; `ARRIS_WEB_DIR` comes from build.rs.
#[derive(rust_embed::RustEmbed)]
#[folder = "$ARRIS_WEB_DIR"]
pub struct WebDist;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasRefRequest {
    /// Canvas id or exact title.
    pub canvas: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasCreateRequest {
    pub title: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CanvasSaveRequest {
    pub id: String,
    pub doc: serde_json::Value,
    pub revision: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CanvasRenameRequest {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CanvasIdRequest {
    pub id: String,
}

/// `CanvasChanged` payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasChangedPayload {
    pub id: String,
    pub revision: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasRunCellRequest {
    pub board_id: String,
    pub target_id: String,
    pub cells: Vec<CanvasCellSpec>,
    pub query_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasQueryCacheRequest {
    pub board_id: String,
    pub sql: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasFetchPageRequest {
    pub board_id: String,
    pub cell_id: String,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryCancelRequest {
    pub query_id: String,
}

/// `CanvasCellIngested` payload: a terminal cell's totals once its background drain ends.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasCellIngestedPayload {
    pub board_id: String,
    pub cell_id: String,
    pub total_rows: u64,
    pub complete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged, rename_all_fields = "camelCase")]
pub enum CanvasAddSource {
    FromRun { run_id: String },
    Manual { sql: String, connection: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasAddRequest {
    /// Canvas id or exact title.
    pub canvas: String,
    pub source: CanvasAddSource,
    /// Defaults to the first SQL line.
    pub title: Option<String>,
    #[serde(default)]
    pub chart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasAddResponse {
    pub canvas: CanvasSummary,
    pub query_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chart_id: Option<String>,
}

/// Only the geometry `canvas_add` needs from the frontend-owned doc.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct CanvasDocGeometry {
    #[serde(default)]
    pub components: Vec<ComponentGeometry>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ComponentGeometry {
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub h: f64,
    #[serde(default)]
    pub z: f64,
}

/// Frontend `BaseComponent` geometry.
#[derive(Debug, Clone, Serialize)]
pub struct ComponentFrame {
    pub id: String,
    pub kind: &'static str,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub z: f64,
}

/// Frontend `QueryComponent`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryComponentDoc {
    #[serde(flatten)]
    pub frame: ComponentFrame,
    pub connection_id: Uuid,
    pub sql: String,
    pub title: String,
}

/// Frontend `ChartComponent` without a spec; the board fills a default on first result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartComponentDoc {
    #[serde(flatten)]
    pub frame: ComponentFrame,
    pub source_query_id: String,
}

/// Frontend `CanvasEdge`.
#[derive(Debug, Clone, Serialize)]
pub struct CanvasEdgeDoc {
    pub id: String,
    pub source: String,
    pub target: String,
}

/// `--dir` for a dbt or sqlmesh call, relative to the project root.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AnalyticsDirRequest {
    pub dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsModelRequest {
    pub dir: Option<String>,
    pub name: String,
}

/// Whole-project graph without `name`; column lineage when `column` is set.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AnalyticsLineageRequest {
    pub dir: Option<String>,
    pub name: Option<String>,
    pub column: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsLineageResponse {
    pub graph: LineageGraph,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<ColumnLineageGraph>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtModelSummary {
    pub unique_id: String,
    pub name: String,
    pub schema: Option<String>,
    pub materialized: Option<String>,
    pub depends_on: Vec<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtModelsResponse {
    pub project_name: String,
    pub root: String,
    pub models: Vec<DbtModelSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtModelDetail {
    #[serde(flatten)]
    pub summary: DbtModelSummary,
    pub description: Option<String>,
    pub raw_sql: String,
    pub compiled_sql: Option<String>,
    pub columns: Vec<DbtColumnDoc>,
    pub upstream: Vec<String>,
    pub downstream: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlMeshModelSummary {
    pub name: String,
    pub kind: String,
    pub cron: Option<String>,
    pub owner: Option<String>,
    pub depends_on: Vec<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlMeshModelsResponse {
    pub root: String,
    pub models: Vec<SqlMeshModelSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlMeshModelDetail {
    #[serde(flatten)]
    pub summary: SqlMeshModelSummary,
    pub description: Option<String>,
    pub raw_sql: String,
    pub columns: Vec<SqlMeshColumnDoc>,
    pub upstream: Vec<String>,
    pub downstream: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolRunRecordRequest {
    pub record: ToolRunRecord,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolRunListRequest {
    pub tool: Option<ToolKind>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolRunIdRequest {
    pub id: String,
}

/// `ToolRunsChanged` payload and `tool_run_record` response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolRunIdPayload {
    pub id: String,
}

/// A tool run without its output, which can hold secrets the tool printed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolRunMeta {
    pub id: String,
    pub tool: ToolKind,
    pub args: Vec<String>,
    pub dir: String,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub finished_at: Option<chrono::DateTime<chrono::Utc>>,
    pub exit_code: Option<i32>,
    pub summary: Option<ToolRunSummary>,
}

impl From<ToolRunRecord> for ToolRunMeta {
    fn from(r: ToolRunRecord) -> Self {
        Self {
            id: r.id,
            tool: r.tool,
            args: r.args,
            dir: r.dir,
            started_at: r.started_at,
            finished_at: r.finished_at,
            exit_code: r.exit_code,
            summary: r.summary,
        }
    }
}
