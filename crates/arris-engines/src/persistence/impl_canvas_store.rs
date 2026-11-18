use std::path::PathBuf;

use chrono::Utc;
use serde_json::{Value, json};
use tokio::fs;
use uuid::Uuid;

use super::constants::{
    CANVAS_COMPONENTS_KEY, CANVAS_DIR_NAME, CANVAS_DOC_VERSION, CANVAS_EDGE_ENDS, CANVAS_EDGES_KEY,
    CANVAS_FILE_EXT, CANVAS_ID_KEY, CANVAS_INITIAL_REVISION, CANVAS_REVISION_STEP,
    CANVAS_VERSION_KEY,
};
use super::impl_json_store::JsonFile;
use super::{CanvasRecord, CanvasSummary, StoreError};

/// One `<id>.json` file per canvas under the project data dir.
pub struct CanvasStore {
    dir: PathBuf,
}

impl CanvasStore {
    pub fn new(project_dir: PathBuf) -> Self {
        Self {
            dir: project_dir.join(CANVAS_DIR_NAME),
        }
    }

    /// Ids become file names, so anything but a UUID is unknown (blocks path traversal).
    fn path(&self, id: &str) -> Result<PathBuf, StoreError> {
        Uuid::parse_str(id).map_err(|_| StoreError::NotFound(id.to_owned()))?;
        Ok(self.dir.join(id).with_extension(CANVAS_FILE_EXT))
    }

    fn corrupt(file: &std::path::Path, reason: impl ToString) -> StoreError {
        StoreError::Corrupt {
            file: file.display().to_string(),
            reason: reason.to_string(),
        }
    }

    async fn read(file: &std::path::Path) -> Result<CanvasRecord, StoreError> {
        let bytes = fs::read(file).await?;
        let record: CanvasRecord =
            serde_json::from_slice(&bytes).map_err(|e| Self::corrupt(file, e))?;
        if file.file_stem().and_then(|s| s.to_str()) != Some(record.id.as_str()) {
            return Err(Self::corrupt(file, "id does not match file name"));
        }
        Ok(record)
    }

    async fn write(&self, record: &CanvasRecord) -> Result<(), StoreError> {
        let bytes = serde_json::to_vec_pretty(record)?;
        JsonFile::atomic_write(&self.path(&record.id)?, bytes).await
    }

    /// Unreadable files are logged and skipped so one bad canvas hides nothing else.
    pub async fn list(&self) -> Result<Vec<CanvasSummary>, StoreError> {
        let mut entries = match fs::read_dir(&self.dir).await {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut out = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            let file = entry.path();
            if file.extension().and_then(|e| e.to_str()) != Some(CANVAS_FILE_EXT) {
                continue;
            }
            match Self::read(&file).await {
                Ok(r) => out.push(CanvasSummary::from(r)),
                Err(e) => tracing::warn!("skipping unreadable canvas: {e}"),
            }
        }
        Ok(out)
    }

    pub async fn get(&self, id: &str) -> Result<CanvasRecord, StoreError> {
        let file = self.path(id)?;
        Self::read(&file).await.map_err(|e| match e {
            StoreError::Io(io) if io.kind() == std::io::ErrorKind::NotFound => {
                StoreError::NotFound(id.to_owned())
            }
            other => other,
        })
    }

    pub async fn create(&self, title: String) -> Result<CanvasRecord, StoreError> {
        let now = Utc::now();
        let record = CanvasRecord {
            id: Uuid::new_v4().to_string(),
            title,
            created_at: now,
            updated_at: now,
            revision: CANVAS_INITIAL_REVISION,
            doc: json!({
                CANVAS_VERSION_KEY: CANVAS_DOC_VERSION,
                CANVAS_COMPONENTS_KEY: [],
                CANVAS_EDGES_KEY: [],
            }),
        };
        self.write(&record).await?;
        Ok(record)
    }

    async fn update(
        &self,
        id: &str,
        edit: impl FnOnce(&mut CanvasRecord) -> Result<(), StoreError>,
    ) -> Result<CanvasRecord, StoreError> {
        let mut record = self.get(id).await?;
        edit(&mut record)?;
        record.updated_at = Utc::now();
        record.revision += CANVAS_REVISION_STEP;
        self.write(&record).await?;
        Ok(record)
    }

    pub async fn save(
        &self,
        id: &str,
        doc: Value,
        expected_revision: u64,
    ) -> Result<CanvasRecord, StoreError> {
        let valid = [CANVAS_COMPONENTS_KEY, CANVAS_EDGES_KEY]
            .iter()
            .all(|k| doc.get(k).is_some_and(Value::is_array));
        if !valid {
            return Err(StoreError::InvalidDoc(format!(
                "doc must be an object with array `{CANVAS_COMPONENTS_KEY}` and `{CANVAS_EDGES_KEY}`"
            )));
        }
        self.update(id, |r| {
            if r.revision != expected_revision {
                return Err(StoreError::RevisionConflict {
                    current: r.revision,
                });
            }
            r.doc = doc;
            Ok(())
        })
        .await
    }

    pub async fn rename(&self, id: &str, title: String) -> Result<CanvasRecord, StoreError> {
        self.update(id, |r| {
            r.title = title;
            Ok(())
        })
        .await
    }

    pub async fn delete(&self, id: &str) -> Result<(), StoreError> {
        let file = self.path(id)?;
        fs::remove_file(&file).await.map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => StoreError::NotFound(id.to_owned()),
            _ => e.into(),
        })
    }

    pub async fn append_components(
        &self,
        id: &str,
        components: Vec<Value>,
        edges: Vec<Value>,
    ) -> Result<CanvasRecord, StoreError> {
        let file = self.path(id)?;
        self.update(id, |r| {
            for (key, items) in [
                (CANVAS_COMPONENTS_KEY, components),
                (CANVAS_EDGES_KEY, edges),
            ] {
                let list = r
                    .doc
                    .as_object_mut()
                    .map(|o| o.entry(key).or_insert_with(|| json!([])))
                    .and_then(Value::as_array_mut)
                    .ok_or_else(|| Self::corrupt(&file, format!("`{key}` is not an array")))?;
                list.extend(items);
            }
            Ok(())
        })
        .await
    }
}

// Single-object edits for the CLI; the browser saves whole docs instead.
impl CanvasStore {
    /// Drops one object and every edge touching it, as the board's delete does.
    pub async fn remove_component(
        &self,
        id: &str,
        component_id: &str,
    ) -> Result<CanvasRecord, StoreError> {
        let file = self.path(id)?;
        self.update(id, |r| {
            let touches = |item: &Value, keys: &[&str]| {
                keys.iter()
                    .any(|k| item.get(*k).and_then(Value::as_str) == Some(component_id))
            };
            for (key, ends) in [
                (CANVAS_COMPONENTS_KEY, &[CANVAS_ID_KEY][..]),
                (CANVAS_EDGES_KEY, &CANVAS_EDGE_ENDS[..]),
            ] {
                if let Some(list) = r.doc.get_mut(key) {
                    list.as_array_mut()
                        .ok_or_else(|| Self::corrupt(&file, format!("`{key}` is not an array")))?
                        .retain(|item| !touches(item, ends));
                }
            }
            Ok(())
        })
        .await
    }

    /// Overwrites the given fields of one object; other fields are kept.
    pub async fn patch_component(
        &self,
        id: &str,
        component_id: &str,
        patch: serde_json::Map<String, Value>,
    ) -> Result<CanvasRecord, StoreError> {
        self.update(id, |r| {
            let target = r
                .doc
                .get_mut(CANVAS_COMPONENTS_KEY)
                .and_then(Value::as_array_mut)
                .and_then(|list| {
                    list.iter_mut().find(|c| {
                        c.get(CANVAS_ID_KEY).and_then(Value::as_str) == Some(component_id)
                    })
                })
                .and_then(Value::as_object_mut);
            if let Some(target) = target {
                target.extend(patch);
            }
            Ok(())
        })
        .await
    }
}

impl From<CanvasRecord> for CanvasSummary {
    fn from(r: CanvasRecord) -> Self {
        Self {
            component_count: r
                .doc
                .get(CANVAS_COMPONENTS_KEY)
                .and_then(Value::as_array)
                .map_or(0, Vec::len),
            id: r.id,
            title: r.title,
            created_at: r.created_at,
            updated_at: r.updated_at,
            revision: r.revision,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, CanvasStore) {
        let tmp = tempfile::tempdir().unwrap();
        let store = CanvasStore::new(tmp.path().into());
        (tmp, store)
    }

    #[tokio::test]
    async fn create_then_get_round_trips() {
        let (_tmp, store) = store();
        let made = store.create("Revenue".into()).await.unwrap();
        assert_eq!(store.get(&made.id).await.unwrap(), made);
        assert_eq!(made.doc[CANVAS_COMPONENTS_KEY], json!([]));
        assert_eq!(made.doc[CANVAS_VERSION_KEY], CANVAS_DOC_VERSION);
    }

    #[tokio::test]
    async fn save_with_stale_revision_conflicts() {
        let (_tmp, store) = store();
        let made = store.create("a".into()).await.unwrap();
        let saved = store
            .save(
                &made.id,
                json!({"components": [], "edges": [], "x": 1}),
                made.revision,
            )
            .await
            .unwrap();
        assert_eq!(saved.revision, made.revision + CANVAS_REVISION_STEP);
        let err = store
            .save(
                &made.id,
                json!({"components": [], "edges": [], "x": 2}),
                made.revision,
            )
            .await
            .unwrap_err();
        assert!(
            matches!(err, StoreError::RevisionConflict { current } if current == saved.revision)
        );
        assert_eq!(
            store.get(&made.id).await.unwrap().doc,
            json!({"components": [], "edges": [], "x": 1})
        );
    }

    #[tokio::test]
    async fn list_skips_corrupt_file() {
        let (tmp, store) = store();
        let made = store.create("ok".into()).await.unwrap();
        std::fs::write(
            tmp.path()
                .join(CANVAS_DIR_NAME)
                .join(format!("bad.{CANVAS_FILE_EXT}")),
            "{nope",
        )
        .unwrap();
        let listed = store.list().await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, made.id);
    }

    #[tokio::test]
    async fn get_corrupt_file_names_it() {
        let (tmp, store) = store();
        let id = Uuid::new_v4().to_string();
        let file = tmp
            .path()
            .join(CANVAS_DIR_NAME)
            .join(format!("{id}.{CANVAS_FILE_EXT}"));
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, r#"{"id":"x"}"#).unwrap();
        let err = store.get(&id).await.unwrap_err();
        assert!(err.to_string().contains(&id), "{err}");
    }

    #[tokio::test]
    async fn append_components_bumps_revision() {
        let (_tmp, store) = store();
        let made = store.create("a".into()).await.unwrap();
        let out = store
            .append_components(
                &made.id,
                vec![json!({"id": "c1"})],
                vec![json!({"id": "e1"})],
            )
            .await
            .unwrap();
        assert_eq!(out.revision, made.revision + CANVAS_REVISION_STEP);
        assert_eq!(out.doc[CANVAS_COMPONENTS_KEY], json!([{"id": "c1"}]));
        assert_eq!(out.doc[CANVAS_EDGES_KEY], json!([{"id": "e1"}]));
    }

    #[tokio::test]
    async fn remove_component_drops_its_edges_and_patch_merges_fields() {
        let (_tmp, store) = store();
        let made = store.create("a".into()).await.unwrap();
        let q = json!({"id": "q", "kind": "query"});
        let c = json!({"id": "c", "kind": "chart", "spec": {"xColumn": ""}});
        let edge = json!({"id": "e", "source": "q", "target": "c"});
        store
            .append_components(&made.id, vec![q, c], vec![edge])
            .await
            .unwrap();
        let mut patch = serde_json::Map::new();
        patch.insert("spec".into(), json!({"xColumn": "k"}));
        let patched = store.patch_component(&made.id, "c", patch).await.unwrap();
        assert_eq!(
            patched.doc[CANVAS_COMPONENTS_KEY][1]["spec"]["xColumn"],
            "k"
        );
        assert_eq!(patched.doc[CANVAS_COMPONENTS_KEY][1]["kind"], "chart");
        let out = store.remove_component(&made.id, "q").await.unwrap();
        assert_eq!(out.doc[CANVAS_COMPONENTS_KEY].as_array().unwrap().len(), 1);
        assert_eq!(out.doc[CANVAS_EDGES_KEY], json!([]));
    }

    #[tokio::test]
    async fn delete_removes_file() {
        let (_tmp, store) = store();
        let made = store.create("a".into()).await.unwrap();
        store.delete(&made.id).await.unwrap();
        assert!(matches!(
            store.get(&made.id).await,
            Err(StoreError::NotFound(_))
        ));
        assert!(matches!(
            store.delete(&made.id).await,
            Err(StoreError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn save_rejects_malformed_doc() {
        let (_tmp, store) = store();
        let made = store.create("a".into()).await.unwrap();
        for bad in [json!(null), json!(3), json!({"components": []})] {
            let err = store.save(&made.id, bad, made.revision).await.unwrap_err();
            assert!(matches!(err, StoreError::InvalidDoc(_)));
        }
    }

    #[tokio::test]
    async fn list_skips_file_whose_inner_id_mismatches() {
        let (tmp, store) = store();
        let made = store.create("a".into()).await.unwrap();
        let dir = tmp.path().join(CANVAS_DIR_NAME);
        let copy = dir.join(format!("{}.{CANVAS_FILE_EXT}", Uuid::new_v4()));
        std::fs::copy(dir.join(format!("{}.{CANVAS_FILE_EXT}", made.id)), copy).unwrap();
        assert_eq!(store.list().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn get_file_whose_inner_id_mismatches_is_corrupt() {
        let (tmp, store) = store();
        let made = store.create("a".into()).await.unwrap();
        let dir = tmp.path().join(CANVAS_DIR_NAME);
        let other = Uuid::new_v4().to_string();
        std::fs::copy(
            dir.join(format!("{}.{CANVAS_FILE_EXT}", made.id)),
            dir.join(format!("{other}.{CANVAS_FILE_EXT}")),
        )
        .unwrap();
        let err = store.get(&other).await.unwrap_err();
        assert!(matches!(err, StoreError::Corrupt { .. }) && err.to_string().contains(&other));
    }

    #[tokio::test]
    async fn non_uuid_id_is_not_found() {
        let (_tmp, store) = store();
        assert!(matches!(
            store.get("../x").await,
            Err(StoreError::NotFound(_))
        ));
    }
}
