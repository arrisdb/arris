/// Name of the subdirectory (under the app data dir) that holds debug logs.
pub const DEBUG_LOGS_DIR_NAME: &str = "debug_logs";

/// Dedicated tracing target for curated, redaction-safe debug events. The file
/// sink is filtered to THIS target only, so dependency crates (sqlx,
/// tokio-postgres, mongodb, ...) that log raw SQL and parameters can never reach
/// the persisted file.
pub(super) const DEBUG_TARGET: &str = "arris_debug";

pub(super) const LOG_FILE_NAME: &str = "debug.log";
pub(super) const ROTATED_FILE_NAME: &str = "debug.log.1";

/// Size cap for the active log file before it rotates to `debug.log.1`.
pub(super) const MAX_LOG_BYTES: u64 = 10 * 1024 * 1024;

/// Per-layer filter for the file sink: everything off, only `arris_debug` at
/// DEBUG. This is the single line that enforces the redaction guarantee.
pub(super) const FILTER_DIRECTIVE: &str = "off,arris_debug=debug";

/// Max length (in chars) of a redacted error detail persisted per failure
/// event. Generous so verbose driver errors (e.g. a MongoDB topology dump)
/// survive intact for debugging, but still bounded so one failure cannot bloat
/// the log. The file itself is independently size capped.
pub(super) const MAX_DETAIL_LEN: usize = 2000;
