use std::path::{Path, PathBuf};

use crate::connection::types::ConnectionConfig;
use crate::persistence::{DataPaths, JsonCollectionStore, ProjectError};
use crate::{
    CanvasStore, ConnectionsStore, ConsoleTabsStore, FederationTabsStore, PaneLayoutStore,
    PinnedQueriesStore, QueryRunStore, RunHistoryStore, ToolRunStore,
};

pub struct ProjectState {
    pub root: PathBuf,
    pub arris_dir: PathBuf,
    pub connections_store: ConnectionsStore,
    pub tabs_store: ConsoleTabsStore,
    pub federation_tabs_store: FederationTabsStore,
    pub pinned_queries_store: PinnedQueriesStore,
    pub run_history_store: RunHistoryStore,
    pub pane_layout_store: PaneLayoutStore,
    pub canvas_store: CanvasStore,
    pub query_run_store: QueryRunStore,
    pub tool_run_store: ToolRunStore,
    pub connections: Vec<ConnectionConfig>,
}

impl ProjectState {
    pub async fn open(base: &Path, root: PathBuf) -> Result<Self, ProjectError> {
        let arris_dir = DataPaths::ensure_project_data_dir(base, &root)?;
        let connections_store = ConnectionsStore::new(arris_dir.clone());
        let query_run_store = QueryRunStore::new(arris_dir.clone());
        // Best effort: a corrupt run log must not block opening the project.
        let _ = query_run_store.fail_interrupted().await;
        let connections = connections_store.load().await.unwrap_or_default();
        Ok(Self {
            root,
            connections_store,
            tabs_store: ConsoleTabsStore::new(arris_dir.clone()),
            federation_tabs_store: FederationTabsStore::new(arris_dir.clone()),
            pinned_queries_store: PinnedQueriesStore::new(arris_dir.clone()),
            run_history_store: RunHistoryStore::new(arris_dir.clone()),
            pane_layout_store: PaneLayoutStore::new(arris_dir.clone()),
            canvas_store: CanvasStore::new(arris_dir.clone()),
            query_run_store,
            tool_run_store: ToolRunStore::new(arris_dir.clone()),
            arris_dir,
            connections,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn open_creates_dir_under_base_not_project_root() {
        let base = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let state = ProjectState::open(base.path(), root.path().to_path_buf())
            .await
            .unwrap();
        assert!(state.arris_dir.is_dir());
        assert!(state.arris_dir.starts_with(base.path()));
        assert!(!root.path().join(".arris").exists());
        assert!(state.connections.is_empty());
    }

    #[tokio::test]
    async fn open_fails_runs_left_running() {
        use crate::persistence::{RunRecord, RunSource, RunStatus};

        let base = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let first = ProjectState::open(base.path(), root.path().to_path_buf())
            .await
            .unwrap();
        let stuck = RunRecord {
            id: "r".into(),
            connection_id: uuid::Uuid::nil(),
            sql: "SELECT 1".into(),
            source: RunSource::Cli,
            started_at: chrono::Utc::now(),
            finished_at: None,
            status: RunStatus::Running,
            row_count: None,
            error: None,
            preview: None,
        };
        first.query_run_store.append(stuck).await.unwrap();
        let reopened = ProjectState::open(base.path(), root.path().to_path_buf())
            .await
            .unwrap();
        let run = reopened.query_run_store.get("r").await.unwrap().unwrap();
        assert_eq!(run.status, RunStatus::Error);
    }

    #[tokio::test]
    async fn open_reads_existing_connections() {
        use crate::connection::types::DatabaseKind;

        let base = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let arris = DataPaths::ensure_project_data_dir(base.path(), root.path()).unwrap();
        let cfg = ConnectionConfig::new("test", DatabaseKind::Postgres);
        let json = serde_json::to_vec_pretty(&vec![&cfg]).unwrap();
        std::fs::write(arris.join("connections.json"), json).unwrap();

        let state = ProjectState::open(base.path(), root.path().to_path_buf())
            .await
            .unwrap();
        assert_eq!(state.connections.len(), 1);
        assert_eq!(state.connections[0].name, "test");
    }
}
