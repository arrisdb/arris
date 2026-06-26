use super::constants::{FILTER_DIRECTIVE, MAX_LOG_BYTES};
use super::impl_gated_size_capped_writer::GatedSizeCappedWriter;
use super::{DebugLogError, DebugLogHandle};

pub struct DebugLogging;

impl DebugLogging {
    /// Install the process-global tracing subscriber: a stdout layer (governed
    /// by `RUST_LOG`, default `info`) plus a file layer gated by `handle`'s
    /// enabled flag and filtered to the `arris_debug` target only. Call once at
    /// startup.
    pub fn install(handle: &DebugLogHandle) -> Result<(), DebugLogError> {
        let writer = GatedSizeCappedWriter::new(
            handle.logs_dir().to_path_buf(),
            MAX_LOG_BYTES,
            handle.enabled_flag(),
        );
        Self::install_with_writer(writer)
    }

    fn install_with_writer(writer: GatedSizeCappedWriter) -> Result<(), DebugLogError> {
        use tracing_subscriber::layer::SubscriberExt;
        use tracing_subscriber::util::SubscriberInitExt;
        use tracing_subscriber::{fmt, EnvFilter, Layer};

        let stdout = fmt::layer().with_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        );
        let file = fmt::layer()
            .with_ansi(false)
            .with_writer(writer)
            .with_filter(EnvFilter::new(FILTER_DIRECTIVE));

        tracing_subscriber::registry()
            .with(stdout)
            .with(file)
            .try_init()
            .map_err(|_| DebugLogError::AlreadyInitialized)
    }
}
