use arris_engines::RunSource;

pub const SERVER_INFO_FILE: &str = "server.json";
pub const SERVER_INFO_TMP_EXTENSION: &str = "json.tmp";
pub const SERVER_LOCK_FILE: &str = "server.lock";
pub const TOKEN_BYTES: usize = 32;
pub const ARRIS_TOKEN_COOKIE: &str = "arris_token";
pub const LOOPBACK_HOST: &str = "127.0.0.1";
pub const LOCALHOST_HOST: &str = "localhost";
pub const EVENTS_CHANNEL_CAPACITY: usize = 256;
pub const PROJECT_HEADER: &str = "x-arris-project";
pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

pub const ROOT_ROUTE: &str = "/";
pub const HEALTH_ROUTE: &str = "/api/health";
pub const EVENTS_ROUTE: &str = "/api/events";
pub const URL_SCHEME: &str = "http";

pub const BEARER_PREFIX: &str = "Bearer ";
pub const COOKIE_SEPARATOR: char = ';';
pub const NO_STORE: &str = "no-store";
pub const REDACTED: &str = "<redacted>";
pub const PROTOCOL_RELATIVE_PREFIX: &str = "//";
pub const BACKSLASH: char = '\\';
pub const COOKIE_ATTRIBUTES: &str = "HttpOnly; SameSite=Strict; Path=/";
pub(super) const OS_ASSIGNED_PORT: u16 = 0;
#[cfg(unix)]
pub(super) const SERVER_INFO_FILE_MODE: u32 = 0o600;

pub const CONNECTION_LIST_ROUTE: &str = "/api/connection_list";
pub const CONNECTION_SAVE_ROUTE: &str = "/api/connection_save";
pub const CONNECTION_TEST_ROUTE: &str = "/api/connection_test";
pub const CONNECTION_REMOVE_ROUTE: &str = "/api/connection_remove";
pub const SCHEMA_LIST_ROUTE: &str = "/api/schema_list";
pub const QUERY_RUN_ROUTE: &str = "/api/query_run";
pub const HISTORY_LIST_ROUTE: &str = "/api/history_list";
pub const PIN_ADD_ROUTE: &str = "/api/pin_add";
pub const PIN_REMOVE_ROUTE: &str = "/api/pin_remove";
pub const PIN_LIST_ROUTE: &str = "/api/pin_list";
pub const RUN_GET_ROUTE: &str = "/api/run_get";
pub const RUN_PAGE_ROUTE: &str = "/api/run_page";
pub const PIN_RENAME_ROUTE: &str = "/api/pin_rename";
pub const PIN_SAVE_ROUTE: &str = "/api/pin_save";
pub const CANVAS_ID_SEPARATOR: &str = ", ";
pub const CANVAS_LIST_ROUTE: &str = "/api/canvas_list";
pub const CANVAS_GET_ROUTE: &str = "/api/canvas_get";
pub const CANVAS_CREATE_ROUTE: &str = "/api/canvas_create";
pub const CANVAS_SAVE_ROUTE: &str = "/api/canvas_save";
pub const CANVAS_RENAME_ROUTE: &str = "/api/canvas_rename";
pub const CANVAS_DELETE_ROUTE: &str = "/api/canvas_delete";
pub const CANVAS_ADD_ROUTE: &str = "/api/canvas_add";
pub const TOOL_RUN_RECORD_ROUTE: &str = "/api/tool_run_record";
pub const TOOL_RUN_LIST_ROUTE: &str = "/api/tool_run_list";
pub const TOOL_RUN_GET_ROUTE: &str = "/api/tool_run_get";
pub const TOOL_RUN_LIST_DEFAULT_LIMIT: usize = 50;
/// Browser tool-run pages; the run id follows.
pub const DBT_RUNS_PAGE_PREFIX: &str = "/dbt/runs/";
pub const SQLMESH_RUNS_PAGE_PREFIX: &str = "/sqlmesh/runs/";
pub const DBT_MODELS_ROUTE: &str = "/api/dbt_models";
pub const DBT_MODEL_ROUTE: &str = "/api/dbt_model";
pub const DBT_LINEAGE_ROUTE: &str = "/api/dbt_lineage";
pub const SQLMESH_MODELS_ROUTE: &str = "/api/sqlmesh_models";
pub const SQLMESH_MODEL_ROUTE: &str = "/api/sqlmesh_model";
pub const SQLMESH_LINEAGE_ROUTE: &str = "/api/sqlmesh_lineage";
/// Browser lineage pages; `/<model>` follows for a single model's graph.
pub const DBT_LINEAGE_PAGE: &str = "/dbt/lineage";
pub const DBT_LINEAGE_PAGE_PREFIX: &str = "/dbt/lineage/";
pub const SQLMESH_LINEAGE_PAGE: &str = "/sqlmesh/lineage";
pub const SQLMESH_LINEAGE_PAGE_PREFIX: &str = "/sqlmesh/lineage/";
pub const DBT_MODEL_KIND: &str = "model";
/// Browser canvas page path; the canvas id follows and the project rides as a query param.
pub const CANVASES_PAGE_PREFIX: &str = "/canvases/";
/// Added objects stack below the lowest one, left-aligned (frontend `LAYOUT_ORIGIN`/`LAYOUT_GAP`).
pub const CANVAS_ADD_X: f64 = 80.0;
pub const CANVAS_ADD_Y: f64 = 80.0;
pub const CANVAS_ADD_GAP: f64 = 32.0;
/// Frontend `DEFAULT_SIZE` for query and chart objects.
pub const CANVAS_QUERY_W: f64 = 540.0;
pub const CANVAS_QUERY_H: f64 = 300.0;
pub const CANVAS_CHART_W: f64 = 560.0;
pub const CANVAS_CHART_H: f64 = 360.0;
pub const CANVAS_KIND_QUERY: &str = "query";
pub const CANVAS_KIND_CHART: &str = "chart";
pub const CANVAS_Z_STEP: f64 = 1.0;
pub const CANVAS_RUN_CELL_ROUTE: &str = "/api/canvas_run_cell";
pub const CANVAS_QUERY_CACHE_ROUTE: &str = "/api/canvas_query_cache";
pub const CANVAS_FETCH_PAGE_ROUTE: &str = "/api/canvas_fetch_page";
pub const QUERY_CANCEL_ROUTE: &str = "/api/query_cancel";
pub const CANVAS_RUN_CANCELLED_MESSAGE: &str = "Query cancelled";
pub const CANVAS_UPSTREAM_FAILED_MESSAGE: &str = "blocked: an upstream cell failed";
pub const CANVAS_NO_CONNECTION_MESSAGE: &str = "pick a connection for this query cell";
pub const CANVAS_INVALID_CONNECTION_MESSAGE: &str = "invalid connection id";
pub const CANVAS_MIXED_REFS_MESSAGE: &str = "a cell that joins a live table with another cell's \
    result is not supported yet; put the live data in its own cell first";
/// Native Mongo shell statements (`db.<coll>.<verb>(...)`) skip the SQL frontend.
pub const MONGO_SHELL_STMT_PREFIX: &str = "db.";
pub const PROJECT_LIST_ROUTE: &str = "/api/project_list";

pub const QUERY_DEFAULT_LIMIT: u32 = 1000;
pub const HISTORY_DEFAULT_LIMIT: usize = 50;
/// `query_run` always fetches the first page; `limit` is its page size.
pub const QUERY_FIRST_PAGE: u32 = 0;
/// Canvas-cache board holding every run's full result, keyed by run id.
pub const RUN_RESULTS_BOARD: &str = "runs";
pub const RUN_PAGE_MAX_LIMIT: usize = 1000;
/// Browser result page path; the run id follows and the project rides as a query param.
pub const RUNS_PAGE_PREFIX: &str = "/runs/";
pub const QUERY_DEFAULT_SOURCE: RunSource = RunSource::Cli;

pub const CONNECTION_REQUEST_CREATE_ROUTE: &str = "/api/connection_request_create";
pub const CONNECTION_REQUEST_GET_ROUTE: &str = "/api/connection_request_get";
pub const CONNECTION_REQUEST_WAIT_ROUTE: &str = "/api/connection_request_wait";
pub const CONNECTION_REQUEST_CANCEL_ROUTE: &str = "/api/connection_request_cancel";
/// Browser form path; the request id and project root ride as query params.
pub const CONNECTION_NEW_PAGE: &str = "/connections/new";
pub const REQUEST_QUERY_PARAM: &str = "request";
pub const TOKEN_PARAM: &str = "token";
/// Login query param naming the UI path to land on.
pub const NEXT_PARAM: &str = "next";
/// Web UI query param naming the project, so a fresh browser needs no stored state.
pub const PROJECT_QUERY_PARAM: &str = "project";
/// Page query param naming the dbt / SQLMesh subfolder, as given to `--dir`.
pub const DIR_QUERY_PARAM: &str = "dir";
pub const CONNECTION_REQUEST_WAIT_SECS: u64 = 30;
/// Map size that triggers eviction of resolved requests nobody waited for.
pub const CONNECTION_REQUESTS_MAX: usize = 100;

pub const API_PREFIX: &str = "/api/";
pub const INDEX_FILE: &str = "index.html";
pub const INDEX_EMBED_EXPECT: &str = "index.html is embedded";
pub const ASSETS_PREFIX: &str = "assets/";
pub const CACHE_NO_CACHE: &str = "no-cache";
pub const CACHE_IMMUTABLE: &str = "public, max-age=31536000, immutable";
