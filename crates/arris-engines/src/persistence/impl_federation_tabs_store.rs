use std::path::{Path, PathBuf};

use super::{JsonCollectionStore, PersistedFederationTab};

pub struct FederationTabsStore {
    file: PathBuf,
}

impl FederationTabsStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            file: dir.join("federation_tabs.json"),
        }
    }
}

impl JsonCollectionStore for FederationTabsStore {
    type Item = PersistedFederationTab;

    fn file_path(&self) -> &Path {
        &self.file
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn round_trip_persists_text_and_participants() {
        let tmp = tempfile::tempdir().unwrap();
        let store = FederationTabsStore::new(tmp.path().into());
        let tab = PersistedFederationTab {
            id: "f1".into(),
            title: "Cross PG/Mongo".into(),
            participating_connection_ids: vec!["c1".into(), "c2".into()],
            text: "SELECT * FROM pg.users JOIN mongo.events ON 1=1".into(),
        };
        store.save(&[tab.clone()]).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded, vec![tab]);
    }

    #[tokio::test]
    async fn empty_when_file_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let store = FederationTabsStore::new(tmp.path().into());
        assert!(store.load().await.unwrap().is_empty());
    }
}
