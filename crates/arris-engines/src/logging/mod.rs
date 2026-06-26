//! Optional debug logging. When enabled, curated redaction-safe events are
//! persisted to `<data_dir>/debug_logs/debug.log`. The file sink is filtered to
//! the dedicated `arris_debug` target, so dependency crates that log raw SQL and
//! parameters never reach disk. When disabled, nothing is collected.

mod constants;
mod errors;
mod impl_debug_log;
mod impl_debug_log_handle;
mod impl_debug_logging;
mod impl_gated_size_capped_writer;
mod impl_redactor;

pub use constants::DEBUG_LOGS_DIR_NAME;
pub use errors::*;
pub use impl_debug_log::DebugLog;
pub use impl_debug_log_handle::DebugLogHandle;
pub use impl_debug_logging::DebugLogging;
