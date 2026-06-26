use std::path::Path;

use serde::Serialize;
use serde::de::DeserializeOwned;
use tokio::fs;

use super::StoreError;

/// Atomic JSON file I/O shared by every store: writes go to a `.json.tmp`
/// sibling and are renamed into place so a crashed write never truncates the
/// real file.
pub(crate) struct JsonFile;

impl JsonFile {
    async fn ensure_parent(file: &Path) -> Result<(), StoreError> {
        if let Some(parent) = file.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).await?;
            }
        }
        Ok(())
    }

    pub(crate) async fn atomic_write(file: &Path, bytes: Vec<u8>) -> Result<(), StoreError> {
        Self::ensure_parent(file).await?;
        let tmp = file.with_extension("json.tmp");
        fs::write(&tmp, bytes).await?;
        fs::rename(&tmp, file).await?;
        Ok(())
    }
}

#[allow(async_fn_in_trait)]
pub trait JsonCollectionStore {
    type Item: Serialize + DeserializeOwned;

    fn file_path(&self) -> &Path;

    async fn load(&self) -> Result<Vec<Self::Item>, StoreError> {
        let file = self.file_path();
        if !file.exists() {
            return Ok(Vec::new());
        }
        let bytes = fs::read(file).await?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    async fn save(&self, items: &[Self::Item]) -> Result<(), StoreError> {
        let bytes = serde_json::to_vec_pretty(items)?;
        JsonFile::atomic_write(self.file_path(), bytes).await
    }
}

#[allow(async_fn_in_trait)]
pub trait JsonSingletonStore {
    type Item: Serialize + DeserializeOwned + Default;

    fn file_path(&self) -> &Path;

    async fn load(&self) -> Result<Self::Item, StoreError> {
        let file = self.file_path();
        if !file.exists() {
            return Ok(Self::Item::default());
        }
        let bytes = fs::read(file).await?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    async fn save(&self, item: &Self::Item) -> Result<(), StoreError> {
        let bytes = serde_json::to_vec_pretty(item)?;
        JsonFile::atomic_write(self.file_path(), bytes).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use serde::{Deserialize, Serialize};

    #[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
    struct TestItem {
        name: String,
        value: i32,
    }

    struct TestCollectionStore {
        file: PathBuf,
    }

    impl TestCollectionStore {
        fn new(dir: PathBuf) -> Self {
            Self { file: dir.join("test_collection.json") }
        }
    }

    impl JsonCollectionStore for TestCollectionStore {
        type Item = TestItem;
        fn file_path(&self) -> &Path { &self.file }
    }

    #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
    struct TestSingleton {
        enabled: bool,
        label: String,
    }

    impl Default for TestSingleton {
        fn default() -> Self {
            Self { enabled: true, label: String::new() }
        }
    }

    struct TestSingletonStore {
        file: PathBuf,
    }

    impl TestSingletonStore {
        fn new(dir: PathBuf) -> Self {
            Self { file: dir.join("test_singleton.json") }
        }
    }

    impl JsonSingletonStore for TestSingletonStore {
        type Item = TestSingleton;
        fn file_path(&self) -> &Path { &self.file }
    }

    #[tokio::test]
    async fn collection_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let store = TestCollectionStore::new(tmp.path().into());
        let items = vec![
            TestItem { name: "a".into(), value: 1 },
            TestItem { name: "b".into(), value: 2 },
        ];
        store.save(&items).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded, items);
    }

    #[tokio::test]
    async fn collection_empty_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let store = TestCollectionStore::new(tmp.path().into());
        assert!(store.load().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn collection_creates_parent_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let nested = tmp.path().join("a").join("b");
        let store = TestCollectionStore::new(nested);
        store.save(&[TestItem { name: "x".into(), value: 0 }]).await.unwrap();
        assert!(store.file_path().exists());
    }

    #[tokio::test]
    async fn singleton_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let store = TestSingletonStore::new(tmp.path().into());
        let item = TestSingleton { enabled: false, label: "hello".into() };
        store.save(&item).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded, item);
    }

    #[tokio::test]
    async fn singleton_default_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let store = TestSingletonStore::new(tmp.path().into());
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded, TestSingleton::default());
    }

    #[tokio::test]
    async fn singleton_creates_parent_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let nested = tmp.path().join("c").join("d");
        let store = TestSingletonStore::new(nested);
        store.save(&TestSingleton::default()).await.unwrap();
        assert!(store.file_path().exists());
    }

    #[tokio::test]
    async fn atomic_write_does_not_leave_tmp_on_success() {
        let tmp = tempfile::tempdir().unwrap();
        let store = TestCollectionStore::new(tmp.path().into());
        store.save(&[TestItem { name: "x".into(), value: 1 }]).await.unwrap();
        let tmp_file = store.file_path().with_extension("json.tmp");
        assert!(!tmp_file.exists());
    }
}
