use tracing::Level;

use crate::ErrorCode;

use super::constants::DEBUG_TARGET;
use super::impl_redactor::Redactor;

/// Curated, redaction-safe facade. Every method emits ONLY metadata: source
/// kind, event name, timings, row counts, a coarse error code, and a
/// credential-scrubbed error detail. Never query text, literals, result data,
/// credentials, or connection strings. Events are emitted on the dedicated
/// `arris_debug` target so the file filter admits them and nothing else.
pub struct DebugLog;

impl DebugLog {
    pub fn query_started(conn: &str, kind: &str) {
        tracing::event!(target: DEBUG_TARGET, Level::DEBUG, conn, kind, "query.started");
    }

    pub fn query_finished(conn: &str, kind: &str, duration_ms: u64, row_count: usize) {
        tracing::event!(
            target: DEBUG_TARGET,
            Level::DEBUG,
            conn,
            kind,
            duration_ms,
            row_count,
            "query.finished"
        );
    }

    pub fn query_failed(conn: &str, kind: &str, code: ErrorCode, detail: &str) {
        let detail = Redactor::redact(detail);
        tracing::event!(target: DEBUG_TARGET, Level::DEBUG, conn, kind, code = ?code, detail, "query.failed");
    }

    pub fn connection_opened(conn: &str, kind: &str) {
        tracing::event!(target: DEBUG_TARGET, Level::DEBUG, conn, kind, "connection.opened");
    }

    pub fn connection_failed(conn: &str, kind: &str, code: ErrorCode, detail: &str) {
        let detail = Redactor::redact(detail);
        tracing::event!(target: DEBUG_TARGET, Level::DEBUG, conn, kind, code = ?code, detail, "connection.failed");
    }

    /// `conn` is the user-assigned connection name; `scope` names what is being
    /// loaded: the top-level browse for the whole connection, or a single
    /// schema/dataset being expanded. Both are labels/identifiers (structural
    /// metadata), never data or credentials.
    pub fn schema_load_started(conn: &str, kind: &str, scope: &str) {
        tracing::event!(target: DEBUG_TARGET, Level::DEBUG, conn, kind, scope, "schema.load.started");
    }

    pub fn schema_load_finished(
        conn: &str,
        kind: &str,
        scope: &str,
        duration_ms: u64,
        node_count: usize,
    ) {
        tracing::event!(
            target: DEBUG_TARGET,
            Level::DEBUG,
            conn,
            kind,
            scope,
            duration_ms,
            node_count,
            "schema.load.finished"
        );
    }

    pub fn schema_load_failed(conn: &str, kind: &str, scope: &str, code: ErrorCode, detail: &str) {
        let detail = Redactor::redact(detail);
        tracing::event!(target: DEBUG_TARGET, Level::DEBUG, conn, kind, scope, code = ?code, detail, "schema.load.failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logging::constants::{FILTER_DIRECTIVE, MAX_LOG_BYTES};
    use crate::logging::impl_gated_size_capped_writer::GatedSizeCappedWriter;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::{fmt, EnvFilter, Layer};

    fn scoped_file_subscriber(
        dir: std::path::PathBuf,
        enabled: bool,
    ) -> impl tracing::Subscriber + Send + Sync {
        let writer = GatedSizeCappedWriter::new(dir, MAX_LOG_BYTES, Arc::new(AtomicBool::new(enabled)));
        let layer = fmt::layer()
            .with_ansi(false)
            .with_writer(writer)
            .with_filter(EnvFilter::new(FILTER_DIRECTIVE));
        tracing_subscriber::registry().with(layer)
    }

    #[test]
    fn facade_events_are_persisted_with_only_safe_metadata() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let subscriber = scoped_file_subscriber(dir.clone(), true);
        tracing::subscriber::with_default(subscriber, || {
            DebugLog::query_started("Prod DB", "postgres");
            DebugLog::query_finished("Prod DB", "postgres", 42, 7);
            DebugLog::query_failed(
                "Prod DB",
                "postgres",
                ErrorCode::Other,
                "relation \"foo\" does not exist",
            );
        });

        let contents = std::fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(contents.contains("query.started"));
        assert!(contents.contains("query.finished"));
        assert!(contents.contains("query.failed"));
        // safe metadata present
        assert!(contents.contains("postgres"));
        assert!(contents.contains("duration_ms=42"));
        assert!(contents.contains("row_count=7"));
        assert!(contents.contains("Other"));
        // connection name present for disambiguation
        assert!(contents.contains("Prod DB"));
        // error detail surfaced for debugging
        assert!(contents.contains("relation"));
    }

    #[test]
    fn failure_detail_is_credential_scrubbed_before_persisting() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let subscriber = scoped_file_subscriber(dir.clone(), true);
        tracing::subscriber::with_default(subscriber, || {
            DebugLog::connection_failed(
                "Prod DB",
                "postgres",
                ErrorCode::ConnectionFailed,
                "failed to connect to postgres://admin:s3cr3t@db.internal:5432/app",
            );
        });

        let contents = std::fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(contents.contains("connection.failed"));
        assert!(contents.contains("ConnectionFailed"));
        // credentials scrubbed, safe host context retained
        assert!(!contents.contains("s3cr3t"), "{contents}");
        assert!(!contents.contains("admin"), "{contents}");
        assert!(contents.contains("db.internal"), "{contents}");
    }

    #[test]
    fn schema_load_events_persist_metadata_and_scrub_detail() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let subscriber = scoped_file_subscriber(dir.clone(), true);
        tracing::subscriber::with_default(subscriber, || {
            DebugLog::schema_load_started("Warehouse", "bigquery", "(top-level)");
            DebugLog::schema_load_finished("Warehouse", "bigquery", "(top-level)", 13, 4);
            DebugLog::schema_load_failed(
                "Warehouse",
                "bigquery",
                "analytics_dataset",
                ErrorCode::QueryFailed,
                "failed: token=ya29.SECRET_TOKEN expired",
            );
        });

        let contents = std::fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(contents.contains("schema.load.started"));
        assert!(contents.contains("schema.load.finished"));
        assert!(contents.contains("schema.load.failed"));
        // safe metadata present: conn name, kind, scope, counts, the failing dataset name
        assert!(contents.contains("Warehouse"));
        assert!(contents.contains("bigquery"));
        assert!(contents.contains("node_count=4"));
        assert!(contents.contains("duration_ms=13"));
        assert!(contents.contains("analytics_dataset"));
        // credentials in the error detail are scrubbed
        assert!(!contents.contains("ya29.SECRET_TOKEN"), "{contents}");
        assert!(contents.contains("token=<redacted>"), "{contents}");
    }

    #[test]
    fn dependency_targets_never_reach_the_file() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let subscriber = scoped_file_subscriber(dir.clone(), true);
        tracing::subscriber::with_default(subscriber, || {
            DebugLog::query_started("Prod DB", "postgres");
            // Simulate what driver crates emit at DEBUG — raw SQL with literals.
            tracing::debug!(target: "sqlx::query", "SELECT * FROM users WHERE ssn = 'SECRET_PII_123'");
            tracing::info!(target: "tokio_postgres", "password=hunter2 connecting");
        });

        let contents = std::fs::read_to_string(dir.join("debug.log")).unwrap();
        assert!(contents.contains("query.started"));
        assert!(!contents.contains("SECRET_PII_123"));
        assert!(!contents.contains("hunter2"));
        assert!(!contents.contains("sqlx"));
    }

    #[test]
    fn disabled_gate_creates_no_file_and_collects_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let subscriber = scoped_file_subscriber(dir.clone(), false);
        tracing::subscriber::with_default(subscriber, || {
            DebugLog::query_started("Prod DB", "postgres");
            DebugLog::query_finished("Prod DB", "postgres", 1, 1);
        });

        assert!(!dir.join("debug.log").exists());
    }
}
