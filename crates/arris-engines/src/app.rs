use std::path::PathBuf;
use std::sync::Arc;

use thiserror::Error;
use tokio::sync::RwLock;

use crate::logging::{DebugLogHandle, DEBUG_LOGS_DIR_NAME};
use crate::persistence::{
    AppPreferences, AppPreferencesStore, JsonCollectionStore, JsonSingletonStore, ProjectError,
    ProjectOpenResult, ProjectState,
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
}

pub struct AppEnvironment {
    pub agent: crate::agent::AgentEngine,
    pub connection: crate::connection::ConnectionEngine,
    pub dbt: crate::dbt::DbtEngine,
    pub file: crate::file::FileEngine,
    pub git: crate::git::GitEngine,
    pub python: crate::python::PythonEngine,
    pub query: crate::query::QueryEngine,
    pub search: crate::search::SearchEngine,
    pub sqlmesh: crate::sqlmesh::SqlMeshEngine,

    pub preferences_store: AppPreferencesStore,
    pub preferences: RwLock<AppPreferences>,
    pub project: RwLock<Option<ProjectState>>,

    /// Live handle to the debug-logging subsystem. The preferences save command
    /// flips this to toggle log collection without a restart.
    pub debug_log: DebugLogHandle,
}

impl AppEnvironment {
    pub async fn init() -> Result<Arc<Self>, AppEnvironmentError> {
        let dir = crate::persistence::DataPaths::data_dir()?;
        Self::init_at(dir).await
    }

    pub async fn init_at(dir: PathBuf) -> Result<Arc<Self>, AppEnvironmentError> {
        let connection = crate::connection::ConnectionEngine::new(dir.clone()).await;
        let logs_dir = dir.join(DEBUG_LOGS_DIR_NAME);
        let preferences_store = AppPreferencesStore::new(dir);
        let preferences = preferences_store.load().await.unwrap_or_default();
        let debug_log = DebugLogHandle::new(logs_dir, preferences.debug_mode);

        Ok(Arc::new(Self {
            agent: crate::agent::AgentEngine::new(),
            connection,
            dbt: crate::dbt::DbtEngine::new(),
            file: crate::file::FileEngine::new(),
            git: crate::git::GitEngine::new(),
            python: crate::python::PythonEngine::new(),
            query: crate::query::QueryEngine::new(),
            search: crate::search::SearchEngine::new(),
            sqlmesh: crate::sqlmesh::SqlMeshEngine::new(),
            preferences_store,
            preferences: RwLock::new(preferences),
            project: RwLock::new(None),
            debug_log,
        }))
    }

    pub async fn open_project(
        self: &Arc<Self>,
        root: String,
    ) -> Result<ProjectOpenResult, AppEnvironmentError> {
        self.connection.close_all_drivers().await;
        *self.project.write().await = None;

        let mut project = ProjectState::open(PathBuf::from(&root)).await?;
        self.connection.rehydrate_project(&mut project).await;
        *self.project.write().await = Some(project);

        let proj = self.project.read().await;
        let proj_ref = proj.as_ref().expect("project was just set");
        let connections = self.connection.all_connections(Some(proj_ref)).await;
        let tabs = proj_ref.tabs_store.load().await.unwrap_or_default();
        let federation_tabs = proj_ref
            .federation_tabs_store
            .load()
            .await
            .unwrap_or_default();
        Ok(ProjectOpenResult {
            root,
            connections,
            tabs,
            federation_tabs,
        })
    }

    pub async fn close_project(&self) {
        self.connection.close_all_drivers().await;
        *self.project.write().await = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn init_at_creates_environment() {
        let tmp = tempfile::tempdir().unwrap();
        let env = AppEnvironment::init_at(tmp.path().into()).await.unwrap();
        assert!(env.project.read().await.is_none());
    }

    #[tokio::test]
    async fn open_project_returns_result_with_empty_stores() {
        let tmp = tempfile::tempdir().unwrap();
        let env = AppEnvironment::init_at(tmp.path().into()).await.unwrap();
        let project_dir = tempfile::tempdir().unwrap();
        let result = env
            .open_project(project_dir.path().to_str().unwrap().to_string())
            .await
            .unwrap();
        assert_eq!(result.root, project_dir.path().to_str().unwrap());
        assert!(result.tabs.is_empty());
        assert!(result.federation_tabs.is_empty());
        assert!(env.project.read().await.is_some());
    }

    #[tokio::test]
    async fn close_project_clears_state() {
        let tmp = tempfile::tempdir().unwrap();
        let env = AppEnvironment::init_at(tmp.path().into()).await.unwrap();
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
        let env = AppEnvironment::init_at(tmp.path().into()).await.unwrap();
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
        assert_eq!(
            proj.as_ref().unwrap().root,
            dir2.path().to_path_buf()
        );
    }

    #[tokio::test]
    async fn preferences_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let env = AppEnvironment::init_at(tmp.path().into()).await.unwrap();
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
