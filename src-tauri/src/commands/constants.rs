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
