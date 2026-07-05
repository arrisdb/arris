use std::path::{Path, PathBuf};

use super::{JsonSingletonStore, PersistedPaneLayout};

pub struct PaneLayoutStore {
    file: PathBuf,
}

impl PaneLayoutStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            file: dir.join("pane_layout.json"),
        }
    }
}

impl JsonSingletonStore for PaneLayoutStore {
    type Item = PersistedPaneLayout;

    fn file_path(&self) -> &Path {
        &self.file
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn missing_file_yields_default() {
        let tmp = tempfile::tempdir().unwrap();
        let s = PaneLayoutStore::new(tmp.path().into());
        assert_eq!(s.load().await.unwrap(), PersistedPaneLayout::default());
    }

    #[tokio::test]
    async fn round_trips_opaque_layout_tree() {
        let tmp = tempfile::tempdir().unwrap();
        let s = PaneLayoutStore::new(tmp.path().into());
        let layout = PersistedPaneLayout {
            layout: Some(json!({
                "kind": "split",
                "direction": "row",
                "children": [
                    { "kind": "leaf", "id": "g1", "tabIds": ["t1"], "selectedTabId": "t1" },
                    { "kind": "leaf", "id": "g2", "tabIds": ["t2"], "selectedTabId": "t2" }
                ]
            })),
            focused_pane_group_id: Some("g2".into()),
        };
        s.save(&layout).await.unwrap();
        assert_eq!(s.load().await.unwrap(), layout);
    }
}
