use std::path::{Path, PathBuf};

use super::{JsonCollectionStore, PersistedPinnedQuery};

pub struct PinnedQueriesStore {
    file: PathBuf,
}

impl PinnedQueriesStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            file: dir.join("pinned_queries.json"),
        }
    }
}

impl JsonCollectionStore for PinnedQueriesStore {
    type Item = PersistedPinnedQuery;

    fn file_path(&self) -> &Path {
        &self.file
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_query() -> PersistedPinnedQuery {
        PersistedPinnedQuery {
            id: "pq1".into(),
            name: "Revenue".into(),
            text: "SELECT date, amount FROM sales".into(),
            connection_id: Some("conn-1".into()),
            kind: "postgres".into(),
        }
    }

    #[tokio::test]
    async fn round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let store = PinnedQueriesStore::new(tmp.path().into());
        let q = sample_query();
        store.save(&[q.clone()]).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded, vec![q]);
    }

    #[tokio::test]
    async fn empty_when_file_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let store = PinnedQueriesStore::new(tmp.path().into());
        assert!(store.load().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn query_without_connection() {
        let tmp = tempfile::tempdir().unwrap();
        let store = PinnedQueriesStore::new(tmp.path().into());
        let q = PersistedPinnedQuery {
            id: "pq2".into(),
            name: "ad hoc".into(),
            text: "SELECT 1".into(),
            connection_id: None,
            kind: "sqlite".into(),
        };
        store.save(&[q.clone()]).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded, vec![q]);
    }

    #[tokio::test]
    async fn camel_case_json_keys() {
        let q = sample_query();
        let json = serde_json::to_string(&q).unwrap();
        assert!(json.contains("connectionId"));
        assert!(!json.contains("connection_id"));
    }
}
