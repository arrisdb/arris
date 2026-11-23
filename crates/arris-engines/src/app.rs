use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use thiserror::Error;
use tokio::sync::RwLock;

use crate::logging::{DEBUG_LOGS_DIR_NAME, DebugLogHandle};
use crate::persistence::{
    AppPreferences, AppPreferencesStore, DataPaths, JsonCollectionStore, JsonSingletonStore,
    Keychain, ProjectError, ProjectManifest, ProjectOpenResult, ProjectState, SecretStore,
};

use crate::connection::ConnectionError;

#[derive(Debug, Error)]
pub enum AppEnvironmentError {
    #[error("path: {0}")]
    Path(#[from] crate::persistence::PathError),
    #[error("connection: {0}")]
    Connection(#[from] ConnectionError),
    #[error("project: {0}")]
    Project(#[from] ProjectError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

pub struct AppEnvironment {
    pub canvas: crate::canvas::CanvasEngine,
    pub connection: crate::connection::ConnectionEngine,
    pub dbt: crate::dbt::DbtEngine,
    pub file: crate::file::FileEngine,
    pub git: crate::git::GitEngine,
    pub python: crate::python::PythonEngine,
    pub query: crate::query::QueryEngine,
    pub search: crate::search::SearchEngine,
    pub sqlmesh: crate::sqlmesh::SqlMeshEngine,

    pub data_dir: PathBuf,
    pub preferences_store: AppPreferencesStore,
    pub preferences: RwLock<AppPreferences>,
    /// The desktop app's open project.
    pub project: RwLock<Option<ProjectState>>,
    /// Projects the CLI server has opened, keyed by canonical root.
    pub projects: RwLock<HashMap<PathBuf, Arc<RwLock<ProjectState>>>>,

    /// Live handle to the debug-logging subsystem. The preferences save command
    /// flips this to toggle log collection without a restart.
    pub debug_log: DebugLogHandle,
}

impl AppEnvironment {
    pub async fn init() -> Result<Arc<Self>, AppEnvironmentError> {
        let dir = crate::persistence::DataPaths::data_dir()?;
        Self::init_at(dir, Arc::new(Keychain::default())).await
    }

    pub async fn init_at(
        dir: PathBuf,
        secrets: Arc<dyn SecretStore>,
    ) -> Result<Arc<Self>, AppEnvironmentError> {
        let connection =
            crate::connection::ConnectionEngine::new_with_secrets(dir.clone(), secrets).await;
        let logs_dir = dir.join(DEBUG_LOGS_DIR_NAME);
        // Spill files are encrypted under a per-session key; purge any a prior
        // run (or crash) left behind so cached query data never crosses runs.
        let cache_dir = dir.join(crate::canvas::CANVAS_CELL_CACHE_DIR_NAME);
        let _ = std::fs::remove_dir_all(&cache_dir);
        let cell_cache = Arc::new(crate::canvas::CellResultCache::new(
            cache_dir,
            crate::canvas::CELL_CACHE_MEMORY_BUDGET,
            crate::canvas::CELL_CACHE_TOTAL_BUDGET,
        ));
        let preferences_store = AppPreferencesStore::new(dir.clone());
        let preferences = preferences_store.load().await.unwrap_or_default();
        let debug_log = DebugLogHandle::new(logs_dir, preferences.debug_mode);

        Ok(Arc::new(Self {
            canvas: crate::canvas::CanvasEngine::new(cell_cache),
            connection,
            dbt: crate::dbt::DbtEngine::new(),
            file: crate::file::FileEngine::new(),
            git: crate::git::GitEngine::new(),
            python: crate::python::PythonEngine::new(),
            query: crate::query::QueryEngine::new(),
            search: crate::search::SearchEngine::new(),
            sqlmesh: crate::sqlmesh::SqlMeshEngine::new(),
            data_dir: dir,
            preferences_store,
            preferences: RwLock::new(preferences),
            project: RwLock::new(None),
            projects: RwLock::new(HashMap::new()),
            debug_log,
        }))
    }

    pub async fn open_project(
        self: &Arc<Self>,
        root: String,
    ) -> Result<ProjectOpenResult, AppEnvironmentError> {
        self.connection.close_all_drivers().await;
        *self.project.write().await = None;

        let mut project = ProjectState::open(&self.data_dir, PathBuf::from(&root)).await?;
        self.connection.rehydrate_project(&mut project).await;
        *self.project.write().await = Some(project);

        let proj = self.project.read().await;
        let proj_ref = proj.as_ref().expect("project was just set");
        let connections = self.connection.all_connections(Some(proj_ref)).await;
        // Independent per-project files: load them concurrently, not one-by-one.
        let (tabs, federation_tabs, pane_layout) = tokio::join!(
            proj_ref.tabs_store.load(),
            proj_ref.federation_tabs_store.load(),
            proj_ref.pane_layout_store.load(),
        );
        let tabs = tabs.unwrap_or_default();
        let federation_tabs = federation_tabs.unwrap_or_default();
        let pane_layout = pane_layout.unwrap_or_default();
        Ok(ProjectOpenResult {
            root,
            connections,
            tabs,
            federation_tabs,
            pane_layout,
        })
    }

    pub async fn close_project(&self) {
        self.connection.close_all_drivers().await;
        *self.project.write().await = None;
    }

    /// Keyed by canonical root; a racing opener's instance wins so callers share one Arc.
    pub async fn project(
        &self,
        root: &Path,
    ) -> Result<Arc<RwLock<ProjectState>>, AppEnvironmentError> {
        let root = root.canonicalize()?;
        if let Some(p) = self.projects.read().await.get(&root) {
            return Ok(p.clone());
        }
        let mut state = ProjectState::open(&self.data_dir, root.clone()).await?;
        self.connection.rehydrate_project(&mut state).await;
        let mut map = self.projects.write().await;
        Ok(map
            .entry(root)
            .or_insert_with(|| Arc::new(RwLock::new(state)))
            .clone())
    }

    pub fn list_projects(&self) -> Vec<ProjectManifest> {
        DataPaths::list_projects(&self.data_dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::MemorySecretStore;

    #[tokio::test]
    async fn init_at_creates_environment() {
        let tmp = tempfile::tempdir().unwrap();
        let env = AppEnvironment::init_at(tmp.path().into(), Arc::new(MemorySecretStore::new()))
            .await
            .unwrap();
        assert!(env.project.read().await.is_none());
    }

    #[tokio::test]
    async fn open_project_returns_result_with_empty_stores() {
        let tmp = tempfile::tempdir().unwrap();
        let env = AppEnvironment::init_at(tmp.path().into(), Arc::new(MemorySecretStore::new()))
            .await
            .unwrap();
        let project_dir = tempfile::tempdir().unwrap();
        let result = env
            .open_project(project_dir.path().to_str().unwrap().to_string())
            .await
            .unwrap();
        assert_eq!(result.root, project_dir.path().to_str().unwrap());
        assert!(result.tabs.is_empty());
        assert!(result.federation_tabs.is_empty());
        assert_eq!(result.pane_layout, crate::PersistedPaneLayout::default());
        assert!(env.project.read().await.is_some());
    }

    #[tokio::test]
    async fn open_project_returns_saved_pane_layout() {
        use crate::persistence::JsonSingletonStore;

        let tmp = tempfile::tempdir().unwrap();
        let env = AppEnvironment::init_at(tmp.path().into(), Arc::new(MemorySecretStore::new()))
            .await
            .unwrap();
        let project_dir = tempfile::tempdir().unwrap();
        let path = project_dir.path().to_str().unwrap().to_string();

        let layout = crate::PersistedPaneLayout {
            layout: Some(serde_json::json!({ "kind": "leaf", "id": "g1", "tabIds": ["t1"] })),
            focused_pane_group_id: Some("g1".into()),
        };
        env.open_project(path.clone()).await.unwrap();
        {
            let proj = env.project.read().await;
            proj.as_ref()
                .unwrap()
                .pane_layout_store
                .save(&layout)
                .await
                .unwrap();
        }

        // Reopening the same project rehydrates the persisted layout.
        let result = env.open_project(path).await.unwrap();
        assert_eq!(result.pane_layout, layout);
    }

    #[tokio::test]
    async fn close_project_clears_state() {
        let tmp = tempfile::tempdir().unwrap();
        let env = AppEnvironment::init_at(tmp.path().into(), Arc::new(MemorySecretStore::new()))
            .await
            .unwrap();
        let project_dir = tempfile::tempdir().unwrap();
        env.open_project(project_dir.path().to_str().unwrap().to_string())
            .await
            .unwrap();
        assert!(env.project.read().await.is_some());
        env.close_project().await;
        assert!(env.project.read().await.is_none());
    }

    #[tokio::test]
    async fn open_project_replaces_previous_project() {
        let tmp = tempfile::tempdir().unwrap();
        let env = AppEnvironment::init_at(tmp.path().into(), Arc::new(MemorySecretStore::new()))
            .await
            .unwrap();
        let dir1 = tempfile::tempdir().unwrap();
        let dir2 = tempfile::tempdir().unwrap();
        let r1 = env
            .open_project(dir1.path().to_str().unwrap().to_string())
            .await
            .unwrap();
        let r2 = env
            .open_project(dir2.path().to_str().unwrap().to_string())
            .await
            .unwrap();
        assert_eq!(r1.root, dir1.path().to_str().unwrap());
        assert_eq!(r2.root, dir2.path().to_str().unwrap());
        let proj = env.project.read().await;
        assert_eq!(proj.as_ref().unwrap().root, dir2.path().to_path_buf());
    }

    #[tokio::test]
    async fn project_opens_lazily_and_is_cached() {
        let tmp = tempfile::tempdir().unwrap();
        let env = AppEnvironment::init_at(tmp.path().into(), Arc::new(MemorySecretStore::new()))
            .await
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert!(env.projects.read().await.is_empty());
        let a = env.project(dir.path()).await.unwrap();
        let alias = dir.path().join("..").join(dir.path().file_name().unwrap());
        let b = env.project(&alias).await.unwrap();
        assert!(Arc::ptr_eq(&a, &b));
        assert_eq!(env.projects.read().await.len(), 1);
    }

    #[tokio::test]
    async fn project_rejects_nonexistent_root() {
        let tmp = tempfile::tempdir().unwrap();
        let env = AppEnvironment::init_at(tmp.path().into(), Arc::new(MemorySecretStore::new()))
            .await
            .unwrap();
        assert!(env.project(&tmp.path().join("missing")).await.is_err());
    }

    #[tokio::test]
    async fn list_projects_includes_desktop_and_cli_opens() {
        let tmp = tempfile::tempdir().unwrap();
        let env = AppEnvironment::init_at(tmp.path().into(), Arc::new(MemorySecretStore::new()))
            .await
            .unwrap();
        let cli = tempfile::tempdir().unwrap();
        let desktop = tempfile::tempdir().unwrap();
        env.project(cli.path()).await.unwrap();
        env.open_project(desktop.path().to_str().unwrap().to_string())
            .await
            .unwrap();
        let roots: Vec<_> = env.list_projects().into_iter().map(|m| m.root).collect();
        assert_eq!(roots.len(), 2);
        assert!(roots.contains(&cli.path().canonicalize().unwrap()));
        assert!(roots.contains(&desktop.path().canonicalize().unwrap()));
    }

    #[tokio::test]
    async fn preferences_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let env = AppEnvironment::init_at(tmp.path().into(), Arc::new(MemorySecretStore::new()))
            .await
            .unwrap();
        let mut prefs = env.preferences_store.load().await.unwrap_or_default();
        prefs.editor_font_size = 18.0;
        prefs.editor_font_family = Some("JetBrains Mono".into());
        env.preferences_store.save(&prefs).await.unwrap();
        *env.preferences.write().await = prefs;

        let back = env.preferences_store.load().await.unwrap();
        assert_eq!(back.editor_font_size, 18.0);
        assert_eq!(back.editor_font_family.as_deref(), Some("JetBrains Mono"));
    }
}
