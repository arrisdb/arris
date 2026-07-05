use std::path::PathBuf;

use crate::{
    ConnectionsStore, ConsoleTabsStore, FederationTabsStore, PaneLayoutStore, PinnedQueriesStore,
    RunHistoryStore,
};
use crate::connection::types::ConnectionConfig;
use crate::persistence::{DataPaths, JsonCollectionStore, ProjectError};

pub struct ProjectState {
    pub root: PathBuf,
    pub arris_dir: PathBuf,
    pub connections_store: ConnectionsStore,
    pub tabs_store: ConsoleTabsStore,
    pub federation_tabs_store: FederationTabsStore,
    pub pinned_queries_store: PinnedQueriesStore,
    pub run_history_store: RunHistoryStore,
    pub pane_layout_store: PaneLayoutStore,
    pub connections: Vec<ConnectionConfig>,
}

impl ProjectState {
    pub async fn open(root: PathBuf) -> Result<Self, ProjectError> {
        let arris_dir = DataPaths::ensure_project_data_dir(&root)?;
        let connections_store = ConnectionsStore::new(arris_dir.clone());
        let tabs_store = ConsoleTabsStore::new(arris_dir.clone());
        let federation_tabs_store = FederationTabsStore::new(arris_dir.clone());
        let pinned_queries_store = PinnedQueriesStore::new(arris_dir.clone());
        let run_history_store = RunHistoryStore::new(arris_dir.clone());
        let pane_layout_store = PaneLayoutStore::new(arris_dir.clone());
        let connections = connections_store.load().await.unwrap_or_default();
        Ok(Self {
            root,
            arris_dir,
            connections_store,
            tabs_store,
            federation_tabs_store,
            pinned_queries_store,
            run_history_store,
            pane_layout_store,
            connections,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn open_creates_arris_dir_and_loads_empty_stores() {
        let tmp = tempfile::tempdir().unwrap();
        let state = ProjectState::open(tmp.path().to_path_buf()).await.unwrap();
        assert!(state.arris_dir.is_dir());
        assert_eq!(state.arris_dir, tmp.path().join(".arris"));
        assert!(state.connections.is_empty());
    }

    #[tokio::test]
    async fn open_reads_existing_connections() {
        use crate::connection::types::DatabaseKind;

        let tmp = tempfile::tempdir().unwrap();
        let arris = tmp.path().join(".arris");
        std::fs::create_dir_all(&arris).unwrap();
        let cfg = ConnectionConfig::new("test", DatabaseKind::Postgres);
        let json = serde_json::to_vec_pretty(&vec![&cfg]).unwrap();
        std::fs::write(arris.join("connections.json"), json).unwrap();

        let state = ProjectState::open(tmp.path().to_path_buf()).await.unwrap();
        assert_eq!(state.connections.len(), 1);
        assert_eq!(state.connections[0].name, "test");
    }
}
