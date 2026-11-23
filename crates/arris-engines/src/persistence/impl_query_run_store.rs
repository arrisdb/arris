use std::path::{Path, PathBuf};

use tokio::sync::Mutex;

use super::constants::QUERY_RUNS_FILE;
use super::{
    INTERRUPTED_RUN_ERROR, JsonCollectionStore, QUERY_RUN_MAX_ENTRIES, RunRecord, RunStatus,
    StoreError,
};

pub struct QueryRunStore {
    file: PathBuf,
    // Serializes read-modify-write so concurrent runs never drop each other's records.
    write_lock: Mutex<()>,
}

impl QueryRunStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            file: dir.join(QUERY_RUNS_FILE),
            write_lock: Mutex::new(()),
        }
    }

    pub async fn append(&self, record: RunRecord) -> Result<(), StoreError> {
        let _write = self.write_lock.lock().await;
        let mut all = self.load().await?;
        all.push(record);
        let excess = all.len().saturating_sub(QUERY_RUN_MAX_ENTRIES);
        all.drain(..excess);
        self.save(&all).await
    }

    pub async fn get(&self, id: &str) -> Result<Option<RunRecord>, StoreError> {
        Ok(self.load().await?.into_iter().find(|r| r.id == id))
    }

    /// Fails runs left `running` by a previous server process; nothing is written when none are.
    pub async fn fail_interrupted(&self) -> Result<(), StoreError> {
        let _write = self.write_lock.lock().await;
        let mut all = self.load().await?;
        let mut changed = false;
        for record in all.iter_mut().filter(|r| r.status == RunStatus::Running) {
            record.status = RunStatus::Error;
            record.error = Some(INTERRUPTED_RUN_ERROR.into());
            record.finished_at = Some(chrono::Utc::now());
            changed = true;
        }
        if changed {
            self.save(&all).await?;
        }
        Ok(())
    }

    /// Replaces the record with the same id; an unknown id errors and leaves the file untouched.
    pub async fn update(&self, record: RunRecord) -> Result<(), StoreError> {
        let _write = self.write_lock.lock().await;
        let mut all = self.load().await?;
        let Some(slot) = all.iter_mut().find(|r| r.id == record.id) else {
            return Err(StoreError::NotFound(record.id));
        };
        *slot = record;
        self.save(&all).await
    }
}

impl JsonCollectionStore for QueryRunStore {
    type Item = RunRecord;

    fn file_path(&self) -> &Path {
        &self.file
    }
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};
    use uuid::Uuid;

    use super::*;
    use crate::persistence::{RunSource, RunStatus};

    fn record(id: &str) -> RunRecord {
        RunRecord {
            id: id.into(),
            connection_id: Uuid::nil(),
            sql: "SELECT 1".into(),
            source: RunSource::Cli,
            started_at: Utc.timestamp_opt(1_718_000_000, 0).unwrap(),
            finished_at: None,
            status: RunStatus::Running,
            row_count: None,
            error: None,
            preview: None,
        }
    }

    #[tokio::test]
    async fn append_then_load_returns_record() {
        let tmp = tempfile::tempdir().unwrap();
        let store = QueryRunStore::new(tmp.path().into());
        store.append(record("a")).await.unwrap();
        assert_eq!(store.load().await.unwrap(), vec![record("a")]);
    }

    #[tokio::test]
    async fn run_history_store_get_returns_record_or_none() {
        let tmp = tempfile::tempdir().unwrap();
        let store = QueryRunStore::new(tmp.path().into());
        store.append(record("a")).await.unwrap();
        assert_eq!(store.get("a").await.unwrap(), Some(record("a")));
        assert_eq!(store.get("missing").await.unwrap(), None);
    }

    #[tokio::test]
    async fn fail_interrupted_marks_only_running_records() {
        let tmp = tempfile::tempdir().unwrap();
        let store = QueryRunStore::new(tmp.path().into());
        let mut done = record("done");
        done.status = RunStatus::Success;
        store.append(record("stuck")).await.unwrap();
        store.append(done.clone()).await.unwrap();
        store.fail_interrupted().await.unwrap();
        let all = store.load().await.unwrap();
        assert_eq!(all[0].status, RunStatus::Error);
        assert_eq!(all[0].error.as_deref(), Some(INTERRUPTED_RUN_ERROR));
        assert!(all[0].finished_at.is_some());
        assert_eq!(all[1], done);
    }

    #[tokio::test]
    async fn update_replaces_by_id() {
        let tmp = tempfile::tempdir().unwrap();
        let store = QueryRunStore::new(tmp.path().into());
        store.append(record("a")).await.unwrap();
        let mut done = record("a");
        done.status = RunStatus::Success;
        done.row_count = Some(3);
        store.update(done.clone()).await.unwrap();
        assert_eq!(store.load().await.unwrap(), vec![done]);
    }

    #[tokio::test]
    async fn update_unknown_id_errors_without_rewriting() {
        let tmp = tempfile::tempdir().unwrap();
        let store = QueryRunStore::new(tmp.path().into());
        store.append(record("a")).await.unwrap();
        let before = std::fs::metadata(store.file_path())
            .unwrap()
            .modified()
            .unwrap();
        let err = store.update(record("missing")).await.unwrap_err();
        assert!(matches!(err, StoreError::NotFound(id) if id == "missing"));
        let after = std::fs::metadata(store.file_path())
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(before, after);
        assert_eq!(store.load().await.unwrap(), vec![record("a")]);
    }

    #[test]
    fn run_record_round_trips_with_all_optionals() {
        use crate::{ColumnSpec, QueryValue};
        let mut r = record("full");
        r.status = RunStatus::Error;
        r.finished_at = Some(Utc.timestamp_opt(1_718_000_005, 0).unwrap());
        r.error = Some("boom".into());
        r.row_count = Some(1);
        r.preview = Some(crate::persistence::RunPreview {
            columns: vec![ColumnSpec::new("x", "INTEGER")],
            rows: vec![vec![QueryValue::Int(1)]],
            truncated: true,
        });
        let json = serde_json::to_string(&r).unwrap();
        assert_eq!(serde_json::from_str::<RunRecord>(&json).unwrap(), r);
    }

    #[tokio::test]
    async fn concurrent_appends_keep_every_record() {
        let tmp = tempfile::tempdir().unwrap();
        let store = std::sync::Arc::new(QueryRunStore::new(tmp.path().into()));
        let tasks: Vec<_> = (0..8)
            .map(|i| {
                let store = store.clone();
                tokio::spawn(async move { store.append(record(&i.to_string())).await })
            })
            .collect();
        for t in tasks {
            t.await.unwrap().unwrap();
        }
        assert_eq!(store.load().await.unwrap().len(), 8);
    }

    #[tokio::test]
    async fn append_trims_to_max_entries_keeping_newest() {
        let tmp = tempfile::tempdir().unwrap();
        let store = QueryRunStore::new(tmp.path().into());
        for i in 0..=QUERY_RUN_MAX_ENTRIES {
            store.append(record(&i.to_string())).await.unwrap();
        }
        let all = store.load().await.unwrap();
        assert_eq!(all.len(), QUERY_RUN_MAX_ENTRIES);
        assert_eq!(all[0].id, "1");
    }

    #[tokio::test]
    async fn enums_serialize_lowercase() {
        let json = serde_json::to_string(&record("a")).unwrap();
        assert!(
            json.contains("\"cli\"") && json.contains("\"running\"") && json.contains("startedAt")
        );
    }
}
