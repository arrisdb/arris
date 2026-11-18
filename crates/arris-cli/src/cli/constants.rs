use arris_engines::ToolKind;

use super::AnalyticsTool;
use crate::server::{
    DBT_LINEAGE_PAGE, DBT_LINEAGE_PAGE_PREFIX, DBT_LINEAGE_ROUTE, DBT_MODEL_ROUTE,
    DBT_MODELS_ROUTE, DBT_RUNS_PAGE_PREFIX, SQLMESH_LINEAGE_PAGE, SQLMESH_LINEAGE_PAGE_PREFIX,
    SQLMESH_LINEAGE_ROUTE, SQLMESH_MODEL_ROUTE, SQLMESH_MODELS_ROUTE, SQLMESH_RUNS_PAGE_PREFIX,
};

/// `arris --version`: `(release)` only for release builds with the embedded UI.
pub const VERSION_STRING: &str = concat!(
    env!("CARGO_PKG_VERSION"),
    " (",
    env!("ARRIS_BUILD_KIND"),
    ")"
);

pub const ENV_DATA_DIR: &str = "ARRIS_DATA_DIR";
pub const ENV_TEST_SECRETS: &str = "ARRIS_TEST_SECRETS";
pub const TEST_SECRETS_MEMORY: &str = "memory";
/// Set by Claude Code in every Bash call; names the console the session's queries go to.
pub const ENV_AGENT_SESSION_ID: &str = "CLAUDE_CODE_SESSION_ID";
pub const AGENT_SESSION_SHORT_LEN: usize = 8;
/// Set by tests so CLI runs never open the developer's browser.
pub const ENV_TEST_NO_BROWSER: &str = "ARRIS_TEST_NO_BROWSER";

pub const SERVER_LOG_FILE: &str = "server.log";
pub const SERVER_START_POLL_MS: u64 = 100;
pub const SERVER_START_TIMEOUT_MS: u64 = 10_000;
pub const HEALTH_TIMEOUT_MS: u64 = 1_000;
pub const SERVE_SUBCOMMAND: &str = "serve";
pub const SERVE_BACKGROUND_FLAG: &str = "--background";
/// Token-free line a background server logs once bound.
pub const SERVER_LISTENING_PREFIX: &str = "arris server listening on port ";
#[cfg(unix)]
pub(super) const SERVER_LOG_FILE_MODE: u32 = 0o600;
/// `process_group(0)` puts the child in a new group led by itself.
#[cfg(unix)]
pub(super) const OWN_PROCESS_GROUP: i32 = 0;
/// First fd after stdin/stdout/stderr.
#[cfg(unix)]
pub(super) const FIRST_INHERITABLE_FD: i32 = 3;
/// Upper bound on fds scanned before exec when `_SC_OPEN_MAX` is huge or unknown.
#[cfg(unix)]
pub(super) const MAX_FD_SCAN: i32 = 4096;

pub const EXIT_API_ERROR: u8 = 1;
pub const EXIT_SERVER_UNAVAILABLE: u8 = 2;
pub const EXIT_CANCELLED: u8 = 3;
/// Shell convention for "command not found".
pub const EXIT_TOOL_NOT_FOUND: u8 = 127;
pub const CONNECTION_NEW_TIMEOUT_SECS: u64 = 600;
/// Pause before reconnecting after a failed long-poll.
pub const CONNECTION_NEW_RETRY_MS: u64 = 500;
pub const KIND_LIST_SEPARATOR: &str = ", ";

pub const ERROR_CODE_SERVER_UNAVAILABLE: &str = "server_unavailable";
pub const ERROR_CODE_IO: &str = "io_error";
pub const ERROR_CODE_INVALID_RESPONSE: &str = "invalid_response";
pub const ERROR_CODE_SERVER: &str = "server_error";
pub const ERROR_CODE_CANCELLED: &str = "cancelled";
pub const ERROR_CODE_TIMEOUT: &str = "timeout";
pub const ERROR_CODE_INVALID_KIND: &str = "invalid_kind";
pub const ERROR_CODE_TOOL_NOT_FOUND: &str = "tool_not_found";
pub const ERROR_CODE_UNSUPPORTED_ADAPTER: &str = "unsupported_adapter";
pub const ERROR_CODE_PROJECT_CONFIG_NOT_FOUND: &str = "project_config_not_found";
pub const ERROR_CODE_PROJECT_CONFIG_INVALID: &str = "project_config_invalid";

/// Bytes of combined tool output kept in a tool-run record.
pub const TOOL_RUN_OUTPUT_TAIL_BYTES: usize = 65536;
pub const LINE_FEED: u8 = b'\n';
/// `--dir` label recorded when the tool ran in the project root.
pub const CURRENT_DIR_LABEL: &str = ".";
pub const DBT_EXECUTABLE: &str = "dbt";
pub const SQLMESH_EXECUTABLE: &str = "sqlmesh";
pub const ENV_DBT_BIN: &str = "ARRIS_DBT_BIN";
pub const ENV_SQLMESH_BIN: &str = "ARRIS_SQLMESH_BIN";

pub const DBT_TOOL: AnalyticsTool = AnalyticsTool {
    kind: ToolKind::Dbt,
    executable: DBT_EXECUTABLE,
    bin_env: ENV_DBT_BIN,
    runs_page_prefix: DBT_RUNS_PAGE_PREFIX,
    models_route: DBT_MODELS_ROUTE,
    model_route: DBT_MODEL_ROUTE,
    lineage_route: DBT_LINEAGE_ROUTE,
    lineage_page: DBT_LINEAGE_PAGE,
    lineage_page_prefix: DBT_LINEAGE_PAGE_PREFIX,
};
pub const SQLMESH_TOOL: AnalyticsTool = AnalyticsTool {
    kind: ToolKind::Sqlmesh,
    executable: SQLMESH_EXECUTABLE,
    bin_env: ENV_SQLMESH_BIN,
    runs_page_prefix: SQLMESH_RUNS_PAGE_PREFIX,
    models_route: SQLMESH_MODELS_ROUTE,
    model_route: SQLMESH_MODEL_ROUTE,
    lineage_route: SQLMESH_LINEAGE_ROUTE,
    lineage_page: SQLMESH_LINEAGE_PAGE,
    lineage_page_prefix: SQLMESH_LINEAGE_PAGE_PREFIX,
};
