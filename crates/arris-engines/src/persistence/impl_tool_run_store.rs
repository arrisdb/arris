use std::path::{Path, PathBuf};

use tokio::sync::Mutex;

use super::constants::TOOL_RUNS_FILE;
use super::{JsonCollectionStore, StoreError, TOOL_RUN_HISTORY_MAX, ToolRunRecord};

/// Per-project log of native dbt / sqlmesh runs, oldest first, trimmed to the cap.
pub struct ToolRunStore {
    file: PathBuf,
    write_lock: Mutex<()>,
}

impl ToolRunStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            file: dir.join(TOOL_RUNS_FILE),
            write_lock: Mutex::new(()),
        }
    }

    pub async fn append(&self, record: ToolRunRecord) -> Result<(), StoreError> {
        let _write = self.write_lock.lock().await;
        let mut all = self.load().await?;
        all.push(record);
        let excess = all.len().saturating_sub(TOOL_RUN_HISTORY_MAX);
        all.drain(..excess);
        self.save(&all).await
    }

    pub async fn get(&self, id: &str) -> Result<Option<ToolRunRecord>, StoreError> {
        Ok(self.load().await?.into_iter().find(|r| r.id == id))
    }
}

impl JsonCollectionStore for ToolRunStore {
    type Item = ToolRunRecord;

    fn file_path(&self) -> &Path {
        &self.file
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;
    use crate::persistence::ToolKind;

    fn record(id: &str) -> ToolRunRecord {
        ToolRunRecord {
            id: id.into(),
            tool: ToolKind::Dbt,
            args: vec!["run".into()],
            dir: ".".into(),
            started_at: Utc::now(),
            finished_at: None,
            exit_code: Some(0),
            output_tail: "done".into(),
            summary: None,
        }
    }

    #[tokio::test]
    async fn tool_run_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ToolRunStore::new(tmp.path().into());
        let run = record("a");
        store.append(run.clone()).await.unwrap();
        assert_eq!(store.get("a").await.unwrap(), Some(run));
        assert_eq!(store.get("missing").await.unwrap(), None);
    }

    #[tokio::test]
    async fn tool_run_store_trims_oldest() {
        let tmp = tempfile::tempdir().unwrap();
        let store = ToolRunStore::new(tmp.path().into());
        for i in 0..=TOOL_RUN_HISTORY_MAX {
            store.append(record(&i.to_string())).await.unwrap();
        }
        let all = store.load().await.unwrap();
        assert_eq!(all.len(), TOOL_RUN_HISTORY_MAX);
        assert_eq!(all[0].id, "1");
    }
}
