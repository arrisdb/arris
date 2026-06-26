use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::RwLock;
use uuid::Uuid;

use super::errors::ConnectionError;
use super::impl_ssh_tunnel::SshTunnel;
use super::types::{ActiveConnection, ConnectionConfig, ScopedConnection, TransactionConfig};
use crate::persistence::{ConnectionsStore, JsonCollectionStore, Keychain, ProjectState, SecretStore};
use crate::{driver_for_kind, DatabaseDriver, Engine};

pub struct ConnectionEngine {
    global_connections_store: ConnectionsStore,
    global_connections: RwLock<Vec<ConnectionConfig>>,
    drivers: RwLock<HashMap<Uuid, ActiveConnection>>,
    /// Per-connection transaction settings (commit mode + isolation) chosen in
    /// the UI. Absent entries default to auto-commit.
    tx_configs: RwLock<HashMap<Uuid, TransactionConfig>>,
    secrets: Arc<dyn SecretStore>,
}

impl ConnectionEngine {
    pub async fn new(global_dir: PathBuf) -> Self {
        Self::new_with_secrets(global_dir, Arc::new(Keychain::default())).await
    }

    /// Construct with an injected secret store. Production passes [`Keychain`];
    /// tests pass an in-memory store so they never touch the real keychain.
    pub async fn new_with_secrets(global_dir: PathBuf, secrets: Arc<dyn SecretStore>) -> Self {
        let store = ConnectionsStore::new(global_dir);
        let mut connections = store.load().await.unwrap_or_default();
        Self::rehydrate_connections(secrets.as_ref(), &mut connections);
        Self {
            global_connections_store: store,
            global_connections: RwLock::new(connections),
            drivers: RwLock::new(HashMap::new()),
            tx_configs: RwLock::new(HashMap::new()),
            secrets,
        }
    }

    /// Store the transaction settings for a connection (commit mode +
    /// isolation level). Read by [`QueryEngine`](crate::QueryEngine) to decide
    /// whether to open a manual transaction before running a statement.
    pub async fn set_transaction_config(&self, id: Uuid, config: TransactionConfig) {
        self.tx_configs.write().await.insert(id, config);
    }

    /// The transaction settings for a connection, or the default (auto-commit)
    /// when none was set.
    pub async fn transaction_config(&self, id: Uuid) -> TransactionConfig {
        self.tx_configs
            .read()
            .await
            .get(&id)
            .copied()
            .unwrap_or_default()
    }

    /// Write a connection's secrets to the keychain ahead of persisting the
    /// scrubbed config. Setting a non-empty secret must succeed (fail-loud, no
    /// plain-text fallback); clearing an absent secret is best-effort.
    fn persist_secrets(secrets: &dyn SecretStore, config: &ConnectionConfig) -> Result<(), ConnectionError> {
        let id = config.id.to_string();
        if config.password.is_empty() {
            let _ = secrets.delete_connection_password(&id);
        } else {
            secrets.set_connection_password(&id, &config.password)?;
        }
        match config.ssh_password.as_deref() {
            Some(p) if !p.is_empty() => secrets.set_ssh_passphrase(&id, p)?,
            _ => {
                let _ = secrets.delete_ssh_passphrase(&id);
            }
        }
        Ok(())
    }

    /// Remove every keychain secret owned by a connection so deletion leaves no
    /// orphans. Best-effort: a failed removal is logged, not fatal.
    fn delete_secrets(secrets: &dyn SecretStore, id: Uuid) {
        let id = id.to_string();
        if let Err(e) = secrets.delete_connection_password(&id) {
            tracing::warn!(connection = %id, error = %e, "failed to delete connection password from keychain");
        }
        if let Err(e) = secrets.delete_ssh_passphrase(&id) {
            tracing::warn!(connection = %id, error = %e, "failed to delete ssh passphrase from keychain");
        }
    }

    /// Fill in each connection's secrets from the keychain after loading the
    /// scrubbed `connections.json` (which never carries them).
    fn rehydrate_connections(secrets: &dyn SecretStore, conns: &mut [ConnectionConfig]) {
        for cfg in conns.iter_mut() {
            let id = cfg.id.to_string();
            match secrets.get_connection_password(&id) {
                Ok(Some(p)) => cfg.password = p,
                Ok(None) => {}
                Err(e) => tracing::warn!(connection = %id, error = %e, "failed to read connection password from keychain"),
            }
            match secrets.get_ssh_passphrase(&id) {
                Ok(Some(p)) => cfg.ssh_password = Some(p),
                Ok(None) => {}
                Err(e) => tracing::warn!(connection = %id, error = %e, "failed to read ssh passphrase from keychain"),
            }
        }
    }

    /// Rehydrate a freshly opened project's local connections from the keychain.
    pub async fn rehydrate_project(&self, project: &mut ProjectState) {
        Self::rehydrate_connections(self.secrets.as_ref(), &mut project.connections);
    }

    pub async fn all_connections(
        &self,
        project: Option<&ProjectState>,
    ) -> Vec<ScopedConnection> {
        let drivers = self.drivers.read().await;
        let global = self.global_connections.read().await;
        let mut result: Vec<ScopedConnection> = global
            .iter()
            .map(|c| ScopedConnection {
                config: c.clone(),
                scope: "global".into(),
                is_connected: drivers.contains_key(&c.id),
            })
            .collect();
        if let Some(proj) = project {
            result.extend(proj.connections.iter().map(|c| ScopedConnection {
                config: c.clone(),
                scope: "local".into(),
                is_connected: drivers.contains_key(&c.id),
            }));
        }
        result
    }

    pub async fn save_connection(
        &self,
        config: ConnectionConfig,
        scope: &str,
        project: Option<&mut ProjectState>,
    ) -> Result<(), ConnectionError> {
        // Route secrets to the keychain first. If this fails the save aborts
        // before any scrubbed config is written — no plain-text fallback.
        Self::persist_secrets(self.secrets.as_ref(), &config)?;
        match scope {
            "global" => {
                let mut conns = self.global_connections.write().await;
                if let Some(existing) = conns.iter_mut().find(|c| c.id == config.id) {
                    *existing = config;
                } else {
                    conns.push(config);
                }
                self.global_connections_store.save(&conns).await?;
            }
            "local" => {
                let proj = project.ok_or(ConnectionError::NoProjectOpen)?;
                if let Some(existing) = proj.connections.iter_mut().find(|c| c.id == config.id) {
                    *existing = config;
                } else {
                    proj.connections.push(config);
                }
                proj.connections_store.save(&proj.connections).await?;
            }
            _ => {}
        }
        Ok(())
    }

    pub async fn delete_connection(
        &self,
        id: Uuid,
        project: Option<&mut ProjectState>,
    ) -> Result<(), ConnectionError> {
        self.close_connection(id).await;
        Self::delete_secrets(self.secrets.as_ref(), id);

        {
            let mut conns = self.global_connections.write().await;
            let before = conns.len();
            conns.retain(|c| c.id != id);
            if conns.len() < before {
                self.global_connections_store.save(&conns).await?;
                return Ok(());
            }
        }

        if let Some(proj) = project {
            let before = proj.connections.len();
            proj.connections.retain(|c| c.id != id);
            if proj.connections.len() < before {
                proj.connections_store.save(&proj.connections).await?;
                return Ok(());
            }
        }

        Ok(())
    }

    pub async fn promote_connection(
        &self,
        id: Uuid,
        project: &mut ProjectState,
    ) -> Result<(), ConnectionError> {
        let idx = project
            .connections
            .iter()
            .position(|c| c.id == id)
            .ok_or(ConnectionError::ConnectionNotFound(id))?;
        let config = project.connections.remove(idx);
        project.connections_store.save(&project.connections).await?;

        let mut global = self.global_connections.write().await;
        global.push(config);
        self.global_connections_store.save(&global).await?;
        Ok(())
    }

    pub async fn import_connection(
        &self,
        id: Uuid,
        project: &mut ProjectState,
    ) -> Result<(), ConnectionError> {
        let config = {
            let global = self.global_connections.read().await;
            global
                .iter()
                .find(|c| c.id == id)
                .ok_or(ConnectionError::ConnectionNotFound(id))?
                .clone()
        };
        project.connections.push(config);
        project.connections_store.save(&project.connections).await?;
        Ok(())
    }

    /// Reorder the persisted connections to match `ordered_ids`. Each scope's
    /// stored `Vec` is sorted by the position of its members in `ordered_ids`
    /// so the on-disk order matches what the UI shows. Connections absent from
    /// `ordered_ids` keep their relative order at the end (stable sort).
    /// Cross-scope ordering is not represented — the UI always lists global
    /// connections before local ones, so only the order *within* each scope is
    /// persisted.
    pub async fn reorder_connections(
        &self,
        ordered_ids: &[Uuid],
        project: Option<&mut ProjectState>,
    ) -> Result<(), ConnectionError> {
        let rank: HashMap<Uuid, usize> = ordered_ids
            .iter()
            .enumerate()
            .map(|(index, id)| (*id, index))
            .collect();
        let key = |id: &Uuid| rank.get(id).copied().unwrap_or(usize::MAX);
        {
            let mut global = self.global_connections.write().await;
            global.sort_by_key(|c| key(&c.id));
            self.global_connections_store.save(&global).await?;
        }
        if let Some(proj) = project {
            proj.connections.sort_by_key(|c| key(&c.id));
            proj.connections_store.save(&proj.connections).await?;
        }
        Ok(())
    }

    pub async fn find_connection(
        &self,
        id: Uuid,
        project: Option<&ProjectState>,
    ) -> Option<ConnectionConfig> {
        if let Some(c) = self
            .global_connections
            .read()
            .await
            .iter()
            .find(|c| c.id == id)
            .cloned()
        {
            return Some(c);
        }
        if let Some(proj) = project {
            if let Some(c) = proj.connections.iter().find(|c| c.id == id).cloned() {
                return Some(c);
            }
        }
        None
    }

    /// Open an SSH tunnel when the config calls for one and return the config
    /// the driver should actually connect with — `host`/`port` rewritten to the
    /// tunnel's local forward when tunneling, otherwise the config unchanged.
    async fn prepare_config(
        &self,
        config: &ConnectionConfig,
    ) -> Result<(ConnectionConfig, Option<SshTunnel>), ConnectionError> {
        if !config.uses_ssh_tunnel() {
            return Ok((config.clone(), None));
        }
        let tunnel = SshTunnel::open(config).await?;
        let mut effective = config.clone();
        effective.host = tunnel.local_host();
        effective.port = tunnel.local_port();
        Ok((effective, Some(tunnel)))
    }

    pub async fn test_connection(&self, config: &ConnectionConfig) -> Result<(), ConnectionError> {
        let (effective, _tunnel) = self.prepare_config(config).await?;
        let driver = driver_for_kind(config.kind)?;
        driver.connect(&effective).await?;
        driver.close().await;
        Ok(())
    }

    pub async fn open_connection(
        &self,
        config: &ConnectionConfig,
    ) -> Result<Arc<dyn DatabaseDriver>, ConnectionError> {
        if let Some(active) = self.drivers.read().await.get(&config.id) {
            return Ok(active.driver.clone());
        }
        let (effective, tunnel) = self.prepare_config(config).await?;
        let driver = driver_for_kind(config.kind)?;
        driver.connect(&effective).await?;
        let arc: Arc<dyn DatabaseDriver> = Arc::from(driver);
        self.drivers.write().await.insert(
            config.id,
            ActiveConnection {
                driver: arc.clone(),
                _tunnel: tunnel,
            },
        );
        Ok(arc)
    }

    pub async fn driver_for(
        &self,
        id: Uuid,
        project: Option<&ProjectState>,
    ) -> Result<Arc<dyn DatabaseDriver>, ConnectionError> {
        if let Some(active) = self.drivers.read().await.get(&id) {
            return Ok(active.driver.clone());
        }
        let cfg = self
            .find_connection(id, project)
            .await
            .ok_or(ConnectionError::ConnectionNotFound(id))?;
        self.open_connection(&cfg).await
    }

    pub async fn close_connection(&self, id: Uuid) {
        self.tx_configs.write().await.remove(&id);
        if let Some(active) = self.drivers.write().await.remove(&id) {
            active.driver.close().await;
        }
    }

    pub async fn close_all_drivers(&self) {
        let mut drivers = self.drivers.write().await;
        for (_, active) in drivers.drain() {
            let _ = active.driver.close().await;
        }
    }
}

impl Engine for ConnectionEngine {
    fn name(&self) -> &str {
        "connection"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DatabaseKind, ErrorCode, IpcError, QueryLanguage};

    async fn engine_with_dir(dir: &std::path::Path) -> ConnectionEngine {
        ConnectionEngine::new_with_secrets(
            dir.to_path_buf(),
            Arc::new(crate::persistence::MockSecretStore::new()),
        )
        .await
    }

    #[test]
    fn connection_engine_name() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let engine = rt.block_on(engine_with_dir(tmp.path()));
        assert_eq!(engine.name(), "connection");
    }

    #[tokio::test]
    async fn all_connections_empty_initially() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let conns = engine.all_connections(None).await;
        assert!(conns.is_empty());
    }

    #[tokio::test]
    async fn save_and_list_global_connection() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let cfg = ConnectionConfig::new("pg", DatabaseKind::Postgres);
        let id = cfg.id;
        engine.save_connection(cfg, "global", None).await.unwrap();
        let conns = engine.all_connections(None).await;
        assert_eq!(conns.len(), 1);
        assert_eq!(conns[0].config.id, id);
        assert_eq!(conns[0].scope, "global");
        assert!(!conns[0].is_connected);
    }

    #[tokio::test]
    async fn save_connection_global_persists() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let cfg = ConnectionConfig::new("pg", DatabaseKind::Postgres);
        engine.save_connection(cfg, "global", None).await.unwrap();

        let store = ConnectionsStore::new(tmp.path().into());
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "pg");
    }

    #[tokio::test]
    async fn save_connection_local_persists() {
        let global_tmp = tempfile::tempdir().unwrap();
        let proj_tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(global_tmp.path()).await;
        let mut project = ProjectState::open(proj_tmp.path().into()).await.unwrap();

        let cfg = ConnectionConfig::new("local_pg", DatabaseKind::Postgres);
        engine
            .save_connection(cfg, "local", Some(&mut project))
            .await
            .unwrap();

        let store = ConnectionsStore::new(proj_tmp.path().join(".arris"));
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "local_pg");
    }

    #[tokio::test]
    async fn save_connection_local_errors_without_project() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let cfg = ConnectionConfig::new("x", DatabaseKind::Sqlite);
        let err = engine.save_connection(cfg, "local", None).await.unwrap_err();
        assert!(matches!(err, ConnectionError::NoProjectOpen));
    }

    #[tokio::test]
    async fn save_connection_updates_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let mut cfg = ConnectionConfig::new("pg", DatabaseKind::Postgres);
        let id = cfg.id;
        engine
            .save_connection(cfg.clone(), "global", None)
            .await
            .unwrap();

        cfg.name = "pg_updated".into();
        engine.save_connection(cfg, "global", None).await.unwrap();

        let conns = engine.all_connections(None).await;
        assert_eq!(conns.len(), 1);
        assert_eq!(conns[0].config.id, id);
        assert_eq!(conns[0].config.name, "pg_updated");
    }

    #[tokio::test]
    async fn reorder_connections_reorders_and_persists_global_scope() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let a = ConnectionConfig::new("a", DatabaseKind::Postgres);
        let b = ConnectionConfig::new("b", DatabaseKind::Postgres);
        let c = ConnectionConfig::new("c", DatabaseKind::Postgres);
        let (ida, idb, idc) = (a.id, b.id, c.id);
        for cfg in [a, b, c] {
            engine.save_connection(cfg, "global", None).await.unwrap();
        }

        // Reorder to c, a, b.
        engine
            .reorder_connections(&[idc, ida, idb], None)
            .await
            .unwrap();

        let conns = engine.all_connections(None).await;
        assert_eq!(
            conns.iter().map(|c| c.config.id).collect::<Vec<_>>(),
            vec![idc, ida, idb],
        );

        // The new order is persisted to disk.
        let store = ConnectionsStore::new(tmp.path().into());
        let loaded = store.load().await.unwrap();
        assert_eq!(
            loaded.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![idc, ida, idb],
        );
    }

    #[tokio::test]
    async fn delete_connection_removes_from_global() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let cfg = ConnectionConfig::new("del_me", DatabaseKind::Sqlite);
        let id = cfg.id;
        engine.save_connection(cfg, "global", None).await.unwrap();
        engine.delete_connection(id, None).await.unwrap();
        assert!(engine.all_connections(None).await.is_empty());
    }

    #[tokio::test]
    async fn delete_connection_removes_from_local() {
        let global_tmp = tempfile::tempdir().unwrap();
        let proj_tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(global_tmp.path()).await;
        let mut project = ProjectState::open(proj_tmp.path().into()).await.unwrap();

        let cfg = ConnectionConfig::new("del_local", DatabaseKind::Sqlite);
        let id = cfg.id;
        engine
            .save_connection(cfg, "local", Some(&mut project))
            .await
            .unwrap();
        engine
            .delete_connection(id, Some(&mut project))
            .await
            .unwrap();
        assert!(engine.all_connections(Some(&project)).await.is_empty());
    }

    #[tokio::test]
    async fn promote_connection_moves_local_to_global() {
        let global_tmp = tempfile::tempdir().unwrap();
        let proj_tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(global_tmp.path()).await;
        let mut project = ProjectState::open(proj_tmp.path().into()).await.unwrap();

        let cfg = ConnectionConfig::new("promo", DatabaseKind::Sqlite);
        let id = cfg.id;
        engine
            .save_connection(cfg, "local", Some(&mut project))
            .await
            .unwrap();

        engine.promote_connection(id, &mut project).await.unwrap();

        let all = engine.all_connections(Some(&project)).await;
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].scope, "global");
        assert_eq!(all[0].config.id, id);
    }

    #[tokio::test]
    async fn import_connection_copies_global_to_local() {
        let global_tmp = tempfile::tempdir().unwrap();
        let proj_tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(global_tmp.path()).await;
        let mut project = ProjectState::open(proj_tmp.path().into()).await.unwrap();

        let cfg = ConnectionConfig::new("shared", DatabaseKind::Postgres);
        let id = cfg.id;
        engine.save_connection(cfg, "global", None).await.unwrap();

        engine.import_connection(id, &mut project).await.unwrap();

        let all = engine.all_connections(Some(&project)).await;
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|c| c.scope == "global" && c.config.id == id));
        assert!(all.iter().any(|c| c.scope == "local" && c.config.id == id));
    }

    #[tokio::test]
    async fn find_connection_searches_both_scopes() {
        let global_tmp = tempfile::tempdir().unwrap();
        let proj_tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(global_tmp.path()).await;
        let mut project = ProjectState::open(proj_tmp.path().into()).await.unwrap();

        let gc = ConnectionConfig::new("gc", DatabaseKind::Postgres);
        engine
            .save_connection(gc.clone(), "global", None)
            .await
            .unwrap();

        let lc = ConnectionConfig::new("lc", DatabaseKind::Sqlite);
        engine
            .save_connection(lc.clone(), "local", Some(&mut project))
            .await
            .unwrap();

        assert!(engine.find_connection(gc.id, Some(&project)).await.is_some());
        assert!(engine.find_connection(lc.id, Some(&project)).await.is_some());
        assert!(engine.find_connection(Uuid::new_v4(), Some(&project)).await.is_none());
    }

    #[tokio::test]
    async fn open_connection_errors_on_unknown_kind() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let cfg = ConnectionConfig::new("pg", DatabaseKind::Postgres);
        let result = engine.open_connection(&cfg).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn open_and_query_sqlite_in_memory() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let mut cfg = ConnectionConfig::new("mem", DatabaseKind::Sqlite);
        cfg.file_path = Some(":memory:".into());
        engine
            .save_connection(cfg.clone(), "global", None)
            .await
            .unwrap();

        let driver = engine.open_connection(&cfg).await.unwrap();
        let r = driver
            .run_query("SELECT 1 AS x", &[], QueryLanguage::Native)
            .await
            .unwrap();
        assert_eq!(r.columns.len(), 1);
        assert_eq!(r.columns[0].name, "x");
    }

    #[tokio::test]
    async fn driver_for_finds_and_connects() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let mut cfg = ConnectionConfig::new("mem", DatabaseKind::Sqlite);
        cfg.file_path = Some(":memory:".into());
        let id = cfg.id;
        engine.save_connection(cfg, "global", None).await.unwrap();

        let driver = engine.driver_for(id, None).await.unwrap();
        let r = driver
            .run_query("SELECT 42 AS v", &[], QueryLanguage::Native)
            .await
            .unwrap();
        assert_eq!(r.columns[0].name, "v");
    }

    #[tokio::test]
    async fn driver_for_errors_on_unknown_id() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        match engine.driver_for(Uuid::new_v4(), None).await {
            Err(ConnectionError::ConnectionNotFound(_)) => {}
            Ok(_) => panic!("expected ConnectionNotFound"),
            Err(other) => panic!("unexpected error: {other}"),
        }
    }

    #[tokio::test]
    async fn close_connection_drops_driver() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let mut cfg = ConnectionConfig::new("mem", DatabaseKind::Sqlite);
        cfg.file_path = Some(":memory:".into());
        let id = cfg.id;
        engine.save_connection(cfg.clone(), "global", None).await.unwrap();
        engine.open_connection(&cfg).await.unwrap();
        engine.close_connection(id).await;
        assert!(!engine.drivers.read().await.contains_key(&id));
    }

    #[tokio::test]
    async fn driver_for_auto_reconnects_after_close() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let mut cfg = ConnectionConfig::new("mem", DatabaseKind::Sqlite);
        cfg.file_path = Some(":memory:".into());
        let id = cfg.id;
        engine.save_connection(cfg, "global", None).await.unwrap();
        engine.driver_for(id, None).await.unwrap();
        engine.close_connection(id).await;
        assert!(!engine.drivers.read().await.contains_key(&id));
        let driver = engine.driver_for(id, None).await.unwrap();
        assert!(engine.drivers.read().await.contains_key(&id));
        let r = driver
            .run_query("SELECT 42 AS v", &[], QueryLanguage::Native)
            .await
            .unwrap();
        assert_eq!(r.columns[0].name, "v");
    }

    #[tokio::test]
    async fn close_all_drivers_empties_map() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let mut cfg = ConnectionConfig::new("mem", DatabaseKind::Sqlite);
        cfg.file_path = Some(":memory:".into());
        engine.save_connection(cfg.clone(), "global", None).await.unwrap();
        engine.open_connection(&cfg).await.unwrap();
        engine.close_all_drivers().await;
        assert!(engine.drivers.read().await.is_empty());
    }

    #[tokio::test]
    async fn all_connections_merges_global_and_local() {
        let global_tmp = tempfile::tempdir().unwrap();
        let proj_tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(global_tmp.path()).await;
        let mut project = ProjectState::open(proj_tmp.path().into()).await.unwrap();

        let gc = ConnectionConfig::new("global_pg", DatabaseKind::Postgres);
        engine.save_connection(gc, "global", None).await.unwrap();

        let lc = ConnectionConfig::new("local_sqlite", DatabaseKind::Sqlite);
        engine
            .save_connection(lc, "local", Some(&mut project))
            .await
            .unwrap();

        let all = engine.all_connections(Some(&project)).await;
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].scope, "global");
        assert_eq!(all[0].config.name, "global_pg");
        assert_eq!(all[1].scope, "local");
        assert_eq!(all[1].config.name, "local_sqlite");
    }

    #[test]
    fn ipc_error_from_driver_error_preserves_code() {
        let err = ConnectionError::Driver(crate::DriverError::NotConnected);
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, ErrorCode::NotConnected);
    }

    #[test]
    fn ipc_error_from_connection_not_found() {
        let err = ConnectionError::ConnectionNotFound(Uuid::new_v4());
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, ErrorCode::Other);
        assert!(ipc.message.contains("not found"));
    }

    #[test]
    fn ipc_error_from_no_project_open() {
        let err = ConnectionError::NoProjectOpen;
        let ipc: IpcError = err.into();
        assert_eq!(ipc.code, ErrorCode::Other);
        assert!(ipc.message.contains("no project open"));
    }

    #[tokio::test]
    async fn test_connection_succeeds_sqlite_in_memory() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let mut cfg = ConnectionConfig::new("probe", DatabaseKind::Sqlite);
        cfg.file_path = Some(":memory:".into());
        engine.test_connection(&cfg).await.unwrap();
    }

    #[tokio::test]
    async fn test_connection_errors_missing_sqlite_path() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let mut cfg = ConnectionConfig::new("probe", DatabaseKind::Sqlite);
        cfg.file_path = Some("/this/path/should/not/exist/arris_probe.db".into());
        assert!(engine.test_connection(&cfg).await.is_err());
    }

    #[tokio::test]
    async fn test_connection_does_not_persist_driver() {
        let tmp = tempfile::tempdir().unwrap();
        let engine = engine_with_dir(tmp.path()).await;
        let mut cfg = ConnectionConfig::new("probe", DatabaseKind::Sqlite);
        cfg.file_path = Some(":memory:".into());
        engine.test_connection(&cfg).await.unwrap();
        assert!(engine.drivers.read().await.is_empty());
    }

    // ── Keychain credential storage ────────────────────────────────

    use crate::persistence::MockSecretStore;

    async fn engine_with_secrets(
        dir: &std::path::Path,
        secrets: Arc<MockSecretStore>,
    ) -> ConnectionEngine {
        ConnectionEngine::new_with_secrets(dir.to_path_buf(), secrets).await
    }

    fn config_with_secrets() -> ConnectionConfig {
        let mut cfg = ConnectionConfig::new("pg", DatabaseKind::Postgres);
        cfg.host = "db.example.com".into();
        cfg.password = "s3cr3t-pw".into();
        cfg.ssh_host = Some("bastion.example.com".into());
        cfg.ssh_password = Some("ssh-passphrase".into());
        cfg
    }

    #[tokio::test]
    async fn saved_json_contains_no_secret_fields_or_values() {
        let tmp = tempfile::tempdir().unwrap();
        let secrets = Arc::new(MockSecretStore::new());
        let engine = engine_with_secrets(tmp.path(), secrets.clone()).await;

        let cfg = config_with_secrets();
        let id = cfg.id;
        engine.save_connection(cfg, "global", None).await.unwrap();

        // Secrets land in the keychain, keyed by connection id.
        assert_eq!(secrets.raw_get(&format!("pw:{id}")).as_deref(), Some("s3cr3t-pw"));
        assert_eq!(secrets.raw_get(&format!("ssh:{id}")).as_deref(), Some("ssh-passphrase"));

        // The on-disk JSON carries neither the secret keys nor their values.
        let raw = std::fs::read_to_string(tmp.path().join("connections.json")).unwrap();
        assert!(!raw.contains("s3cr3t-pw"), "password value leaked to disk: {raw}");
        assert!(!raw.contains("ssh-passphrase"), "ssh passphrase value leaked to disk: {raw}");
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
        let entry = &parsed[0];
        assert!(entry.get("password").is_none(), "password field present: {raw}");
        assert!(entry.get("sshPassword").is_none(), "sshPassword field present: {raw}");
        // Non-secret metadata still persists.
        assert_eq!(entry["host"], "db.example.com");
        assert_eq!(entry["sshHost"], "bastion.example.com");
    }

    #[tokio::test]
    async fn load_rehydrates_secrets_from_keychain() {
        let tmp = tempfile::tempdir().unwrap();
        let secrets = Arc::new(MockSecretStore::new());
        let cfg = config_with_secrets();
        let id = cfg.id;
        {
            let engine = engine_with_secrets(tmp.path(), secrets.clone()).await;
            engine.save_connection(cfg, "global", None).await.unwrap();
        }

        // A fresh engine over the scrubbed file rehydrates secrets from the store.
        let engine = engine_with_secrets(tmp.path(), secrets).await;
        let loaded = engine.find_connection(id, None).await.unwrap();
        assert_eq!(loaded.password, "s3cr3t-pw");
        assert_eq!(loaded.ssh_password.as_deref(), Some("ssh-passphrase"));
    }

    #[tokio::test]
    async fn delete_connection_clears_keychain_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let secrets = Arc::new(MockSecretStore::new());
        let engine = engine_with_secrets(tmp.path(), secrets.clone()).await;

        let cfg = config_with_secrets();
        let id = cfg.id;
        engine.save_connection(cfg, "global", None).await.unwrap();
        assert!(secrets.raw_get(&format!("pw:{id}")).is_some());

        engine.delete_connection(id, None).await.unwrap();
        assert!(secrets.raw_get(&format!("pw:{id}")).is_none(), "password entry not cleared");
        assert!(secrets.raw_get(&format!("ssh:{id}")).is_none(), "ssh entry not cleared");
    }

    #[tokio::test]
    async fn keychain_write_failure_aborts_save_without_disk_write() {
        let tmp = tempfile::tempdir().unwrap();
        let secrets = Arc::new(MockSecretStore::failing());
        let engine = engine_with_secrets(tmp.path(), secrets).await;

        let cfg = config_with_secrets();
        let err = engine.save_connection(cfg, "global", None).await.unwrap_err();
        assert!(matches!(err, ConnectionError::Keychain(_)), "expected keychain error, got {err:?}");

        // Nothing persisted to disk: no file, and the in-memory list is empty.
        assert!(!tmp.path().join("connections.json").exists(), "connections.json written despite keychain failure");
        assert!(engine.all_connections(None).await.is_empty());
    }
}
