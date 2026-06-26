use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::connection::types::ConnectionConfig;

use super::impl_json_store::JsonFile;
use super::{JsonCollectionStore, StoreError};

pub struct ConnectionsStore {
    file: PathBuf,
}

impl ConnectionsStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            file: dir.join("connections.json"),
        }
    }

    /// Serialize a connection to JSON with the secret fields removed. Secrets
    /// live in the keychain only; the on-disk `connections.json` never holds a
    /// `password` or `sshPassword`.
    fn scrub(config: &ConnectionConfig) -> Result<Value, StoreError> {
        let mut value = serde_json::to_value(config)?;
        if let Some(object) = value.as_object_mut() {
            object.remove("password");
            object.remove("sshPassword");
        }
        Ok(value)
    }
}

impl JsonCollectionStore for ConnectionsStore {
    type Item = ConnectionConfig;

    fn file_path(&self) -> &Path {
        &self.file
    }

    // Override the default save to scrub secrets before they reach disk. The
    // default `load` is reused as-is; the engine rehydrates secrets from the
    // keychain after loading.
    async fn save(&self, items: &[Self::Item]) -> Result<(), StoreError> {
        let scrubbed = items
            .iter()
            .map(Self::scrub)
            .collect::<Result<Vec<Value>, StoreError>>()?;
        let bytes = serde_json::to_vec_pretty(&scrubbed)?;
        JsonFile::atomic_write(self.file_path(), bytes).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::types::DatabaseKind;

    #[tokio::test]
    async fn round_trip_through_json_file() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ConnectionsStore::new(tmp.path().into());
        assert!(store.load().await.unwrap().is_empty());

        let mut cfg = ConnectionConfig::new("local pg", DatabaseKind::Postgres);
        cfg.host = "localhost".into();
        cfg.port = 5432;
        store.save(&[cfg.clone()]).await.unwrap();

        let loaded = store.load().await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].name, "local pg");
        assert_eq!(loaded[0].host, "localhost");
    }

    #[tokio::test]
    async fn save_creates_parent_directory_if_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let nested = tmp.path().join("sub").join("nested");
        let store = ConnectionsStore::new(nested);
        let cfg = ConnectionConfig::new("x", DatabaseKind::Sqlite);
        store.save(&[cfg]).await.unwrap();
        assert!(store.file_path().exists());
    }

    #[tokio::test]
    async fn load_returns_empty_for_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ConnectionsStore::new(tmp.path().into());
        let loaded = store.load().await.unwrap();
        assert!(loaded.is_empty());
    }

    #[tokio::test]
    async fn save_strips_secret_fields_from_disk() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ConnectionsStore::new(tmp.path().into());

        let mut cfg = ConnectionConfig::new("pg", DatabaseKind::Postgres);
        cfg.password = "s3cr3t".into();
        cfg.ssh_host = Some("bastion".into());
        cfg.ssh_password = Some("ssh-pass".into());
        store.save(&[cfg]).await.unwrap();

        let raw = std::fs::read_to_string(store.file_path()).unwrap();
        assert!(!raw.contains("s3cr3t"), "password value on disk: {raw}");
        assert!(!raw.contains("ssh-pass"), "ssh passphrase value on disk: {raw}");
        let parsed: Value = serde_json::from_str(&raw).unwrap();
        assert!(parsed[0].get("password").is_none());
        assert!(parsed[0].get("sshPassword").is_none());
        // Non-secret SSH metadata is retained.
        assert_eq!(parsed[0]["sshHost"], "bastion");
    }
}
