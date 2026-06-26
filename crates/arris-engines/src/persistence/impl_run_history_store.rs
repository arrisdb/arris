use std::path::{Path, PathBuf};

use super::{JsonCollectionStore, PersistedRunHistoryEntry};

pub struct RunHistoryStore {
    file: PathBuf,
}

impl RunHistoryStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            file: dir.join("run_history.json"),
        }
    }
}

impl JsonCollectionStore for RunHistoryStore {
    type Item = PersistedRunHistoryEntry;

    fn file_path(&self) -> &Path {
        &self.file
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_entry() -> PersistedRunHistoryEntry {
        PersistedRunHistoryEntry {
            id: "run-1".into(),
            seq: 1,
            ordinal: 7,
            tab_id: "tab-1".into(),
            tab_title: "Console 80".into(),
            tab_type: Some("console".into()),
            started_at: 1718000000000.0,
            ended_at: Some(1718000000100.0),
            status: "success".into(),
            sql_snapshot: "SELECT 1".into(),
            connection_id: Some("conn-1".into()),
            custom_name: Some("revenue probe".into()),
            pinned: true,
            error: None,
            diff_model: None,
            diff_index: None,
            log_kind: Some("sql".into()),
        }
    }

    #[tokio::test]
    async fn round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let store = RunHistoryStore::new(tmp.path().into());
        let e = sample_entry();
        store.save(&[e.clone()]).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded, vec![e]);
    }

    #[tokio::test]
    async fn empty_when_file_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let store = RunHistoryStore::new(tmp.path().into());
        assert!(store.load().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn camel_case_json_keys() {
        let e = sample_entry();
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("tabId"));
        assert!(json.contains("sqlSnapshot"));
        assert!(json.contains("customName"));
        assert!(!json.contains("tab_id"));
    }

    #[tokio::test]
    async fn minimal_entry_omits_optional_fields() {
        let e = PersistedRunHistoryEntry {
            id: "run-2".into(),
            seq: 2,
            ordinal: 2,
            tab_id: "tab-2".into(),
            tab_title: "Console 81".into(),
            tab_type: None,
            started_at: 1.0,
            ended_at: None,
            status: "error".into(),
            sql_snapshot: "SELECT bad".into(),
            connection_id: None,
            custom_name: None,
            pinned: false,
            error: Some("boom".into()),
            diff_model: None,
            diff_index: None,
            log_kind: None,
        };
        let tmp = tempfile::tempdir().unwrap();
        let store = RunHistoryStore::new(tmp.path().into());
        store.save(&[e.clone()]).await.unwrap();
        assert_eq!(store.load().await.unwrap(), vec![e]);
    }
}
