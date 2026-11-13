//! Constants for the Tauri command layer.

/// argv[0] is the executable path; project-path parsing skips it.
pub const ARGV_PROGRAM_SKIP: usize = 1;

/// Args beginning with this prefix are OS/CLI flags, not a project path.
pub const ARG_FLAG_PREFIX: char = '-';

/// Error shown on the target and its remaining upstream cells when a run is
/// cancelled mid-chain.
pub const CANVAS_RUN_CANCELLED_MESSAGE: &str = "Query cancelled";

/// Tauri event carrying a canvas cell's full-ingest totals once the background
/// drain finishes (the UI page was already returned synchronously).
pub const CANVAS_CELL_INGESTED_EVENT: &str = "canvas://cell-ingested";

/// A canvas cell beginning with this is a native Mongo shell statement
/// (`db.<coll>.<verb>(...)`); no SQL frontend parses it. Everything else is SQL.
pub const MONGO_SHELL_STMT_PREFIX: &str = "db.";

/// Error for project-scoped commands called before a project is open.
pub const NO_PROJECT_OPEN_MESSAGE: &str = "no project open";

/// Overrides the data dir, as for the `arris` CLI, so both can share a scratch dir.
pub const ENV_DATA_DIR: &str = "ARRIS_DATA_DIR";

/// Discovery file the arris server writes in the shared data dir (mirrors the CLI's).
pub const ARRIS_SERVER_INFO_FILE: &str = "server.json";

/// The arris server only listens on loopback.
pub const ARRIS_SERVER_HOST: &str = "127.0.0.1";

pub const ARRIS_SERVER_API_PREFIX: &str = "/api/";

pub const ARRIS_SERVER_EVENTS_PATH: &str = "/api/events";

/// Header naming the project a server call is about.
pub const ARRIS_SERVER_PROJECT_HEADER: &str = "x-arris-project";

/// How often the bridge looks for a (re)started server.
pub const ARRIS_SERVER_RETRY_MS: u64 = 500;

/// Tauri event re-emitting each server event to the windows.
pub const ARRIS_SERVER_EVENT: &str = "arris://server-event";

/// Synthetic event kind sent when the bridge (re)connects.
pub const ARRIS_SERVER_CONNECTED_KIND: &str = "server_connected";

pub const SSE_DATA_PREFIX: &str = "data:";

pub const SSE_FRAME_END: &str = "\n\n";

pub const ARRIS_SERVER_DOWN_MESSAGE: &str = "the arris server is not running";

pub const ARRIS_SERVER_BAD_ROUTE_MESSAGE: &str = "invalid arris server route";
