pub mod drivers;
pub mod persistence;

pub mod agent;
pub mod canvas;
pub mod connection;
pub mod editor;
pub mod dbt;
pub mod federation;
pub mod file;
pub mod git;
pub mod logging;
pub mod python;
pub mod query;
pub mod search;
pub mod sqlmesh;
pub mod terminal;
pub mod app;

pub trait Engine: Send + Sync {
    fn name(&self) -> &str;
}

pub use agent::AgentEngine;
pub use canvas::{
    CanvasCellRun, CanvasCellSpec, CanvasEngine, CanvasError, CellCacheWriter, CellIngestContinuation,
    CellIngestDone, CellResultCache, IngestedCell, CELL_INGEST_BYTE_BUDGET, CELL_RESULT_PAGE_ROWS,
};
pub use connection::{ConnectionEngine, PrefillError, ScopedConnection};
pub use dbt::{DbtEngine, ProfileConnectionMapper};
pub use federation::FederationEngine;
pub use file::{FileEngine, FileTreeEntry, DEFAULT_SKIP_DIRS};
pub use git::GitEngine;
pub use logging::{DebugLog, DebugLogHandle, DebugLogging, DEBUG_LOGS_DIR_NAME};
pub use python::{
    Completion, CreatedVenv, InterpreterSource, KernelOutput, PythonEngine, PythonInterpreter,
};
pub use query::QueryEngine;
pub use search::SearchEngine;
pub use sqlmesh::{GatewayConnectionMapper, SqlMeshEngine};
pub use terminal::TerminalEngine;
pub use app::{AppEnvironment, AppEnvironmentError};

pub use connection::types::{ConnectionConfig, ConnectionPrefill, DatabaseKind, PrefillField, SaslMechanism, SslMode, TransactionConfig};
pub use drivers::errors::{DriverError, ErrorCode, IpcError};
pub use drivers::constants::STREAM_CHUNK_ROWS;
pub use drivers::types::{
    ColumnSpec, ExplainMode, IsolationLevel, MutationResult, ObjectRef, PlanAttribute, PlanNode,
    PlanResult, QueryLanguage, QueryResult, QueryStream, QueryValue, RowChunkStream, RowDelete,
    RowEdit, RowInsert, SchemaNode, SchemaNodeKind, SqlDialect, StatementType,
    TableMutationBatch, TableRef, TransactionMode, ValueMap,
};
pub use drivers::uri::{PostgresUriComponents, parse_postgres_uri};
pub use editor::LineCommentPrefix;
pub use drivers::{DatabaseDriver, PaginationStrategy, driver_for_kind};

pub use persistence::{
    AppPreferences, AppPreferencesStore, CANVAS_DIR_NAME, CANVAS_FILE_EXT, CanvasRecord,
    CanvasStore, CanvasSummary, ConnectionsStore, ConsoleTabsStore, DataPaths,
    FederationTabsStore, JsonCollectionStore, JsonSingletonStore, Keychain, KeychainError,
    PaneLayoutStore, PersistedConsoleTab, PersistedFederationTab, PersistedPaneLayout,
    PersistedPinnedQuery, PersistedRunHistoryEntry, PinnedQueriesStore, ProjectError,
    ProjectManifest, ProjectOpenResult, ProjectState, QUERY_RUN_MAX_ENTRIES, QueryRunStore,
    RUN_PREVIEW_MAX_ROWS, RunHistoryStore, RunPreview, RunRecord, RunSource, RunStatus,
    SecretStore, StoreError, TOOL_RUN_HISTORY_MAX, ToolKind, ToolRunRecord, ToolRunStore,
    ToolRunSummary,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_trait_is_object_safe() {
        fn _assert_object_safe(_: &dyn Engine) {}
    }
}
