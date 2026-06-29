use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::TableRef;
use serde::{Deserialize, Serialize};
use tokio::fs;

use super::impl_json_store::JsonFile;
use super::{PersistedConsoleTab, StoreError};

/// On-disk index entry: every field of [`PersistedConsoleTab`] except `text`.
/// `console_tabs.json` is a flat array of these; the body of each console /
/// notebook lives in its own file so it can be version-controlled.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConsoleTabIndexEntry {
    id: String,
    title: String,
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    connection_id: Option<String>,
    #[serde(default)]
    cursor: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    closed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    is_federation: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tab_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    table_ref: Option<TableRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    table_editable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    created_at: Option<f64>,
}

impl ConsoleTabIndexEntry {
    fn from_tab(t: &PersistedConsoleTab) -> Self {
        Self {
            id: t.id.clone(),
            title: t.title.clone(),
            kind: t.kind.clone(),
            connection_id: t.connection_id.clone(),
            cursor: t.cursor,
            closed: t.closed,
            is_federation: t.is_federation,
            tab_type: t.tab_type.clone(),
            file_path: t.file_path.clone(),
            table_ref: t.table_ref.clone(),
            table_editable: t.table_editable,
            created_at: t.created_at,
        }
    }

    /// Rebuild the runtime tab with an empty body; the caller fills `text` from
    /// the backing file.
    fn into_tab(self) -> PersistedConsoleTab {
        PersistedConsoleTab {
            id: self.id,
            title: self.title,
            text: String::new(),
            kind: self.kind,
            connection_id: self.connection_id,
            cursor: self.cursor,
            closed: self.closed,
            is_federation: self.is_federation,
            tab_type: self.tab_type,
            file_path: self.file_path,
            table_ref: self.table_ref,
            table_editable: self.table_editable,
            created_at: self.created_at,
        }
    }

    /// Notebooks serialize to `.ipynb`; canvas boards to `.canvas.json`;
    /// everything else (SQL consoles) to `.sql`.
    fn ext(&self) -> &'static str {
        match self.tab_type.as_deref() {
            Some("notebook") => "ipynb",
            Some("canvas") => "canvas.json",
            _ => "sql",
        }
    }

    /// A "sidecar" tab is an internal console / notebook whose body lives under
    /// `.arris/files/`. Tabs bound to a real project file (`file_path` set) are
    /// owned by the editor's own save path, not the sidecar store. Table / media
    /// / git-diff tabs have no editable body.
    fn is_sidecar(&self) -> bool {
        self.file_path.is_none()
            && matches!(
                self.tab_type.as_deref(),
                None | Some("console") | Some("notebook") | Some("canvas")
            )
    }

    fn sidecar_name(&self) -> String {
        format!("{}.{}", self.id, self.ext())
    }
}

/// Persists console / notebook tabs as an index (`console_tabs.json`) plus one
/// sidecar file per internal tab under `.arris/files/`. Internal bodies live at
/// `.arris/files/<id>.{sql,ipynb}`; tabs promoted to the project (via
/// [`Self::move_to_project`]) become ordinary file-backed tabs whose content the
/// editor owns.
pub struct ConsoleTabsStore {
    index_file: PathBuf,
    files_dir: PathBuf,
    project_root: PathBuf,
}

impl ConsoleTabsStore {
    pub fn new(dir: PathBuf) -> Self {
        let project_root = dir
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| dir.clone());
        Self {
            index_file: dir.join("console_tabs.json"),
            files_dir: dir.join("files"),
            project_root,
        }
    }

    pub async fn load(&self) -> Result<Vec<PersistedConsoleTab>, StoreError> {
        if !self.index_file.exists() {
            return Ok(Vec::new());
        }
        let bytes = fs::read(&self.index_file).await?;
        let entries: Vec<ConsoleTabIndexEntry> = serde_json::from_slice(&bytes)?;
        let mut out = Vec::with_capacity(entries.len());
        for entry in entries {
            let path = if entry.is_sidecar() {
                Some(self.files_dir.join(entry.sidecar_name()))
            } else {
                entry.file_path.as_deref().map(|fp| self.resolve(fp))
            };
            let text = match path {
                Some(p) => Self::read_body(&p).await?,
                None => String::new(),
            };
            let mut tab = entry.into_tab();
            tab.text = text;
            out.push(tab);
        }
        Ok(out)
    }

    pub async fn save(&self, tabs: &[PersistedConsoleTab]) -> Result<(), StoreError> {
        let mut keep: HashSet<String> = HashSet::new();
        for tab in tabs {
            let entry = ConsoleTabIndexEntry::from_tab(tab);
            if entry.is_sidecar() {
                let path = self.files_dir.join(entry.sidecar_name());
                JsonFile::atomic_write(&path, tab.text.clone().into_bytes()).await?;
                keep.insert(entry.sidecar_name());
            }
        }
        self.prune_sidecars(&keep).await?;
        let entries: Vec<ConsoleTabIndexEntry> =
            tabs.iter().map(ConsoleTabIndexEntry::from_tab).collect();
        let bytes = serde_json::to_vec_pretty(&entries)?;
        JsonFile::atomic_write(&self.index_file, bytes).await
    }

    /// Move a tab's sidecar file out of `.arris/files/` to the project root so
    /// it can be added to version control, then point the index entry at the new
    /// location. Returns the destination path. The tab becomes a normal
    /// file-backed tab and leaves its sidebar section.
    pub async fn move_to_project(&self, id: &str) -> Result<String, StoreError> {
        let bytes = fs::read(&self.index_file).await?;
        let mut entries: Vec<ConsoleTabIndexEntry> = serde_json::from_slice(&bytes)?;
        let idx = entries
            .iter()
            .position(|e| e.id == id)
            .ok_or_else(|| StoreError::NotFound(id.to_string()))?;
        let ext = entries[idx].ext().to_string();
        let src = self.files_dir.join(entries[idx].sidecar_name());
        let name = Self::sanitize_title(&entries[idx].title);
        let dest = self.unique_dest(&name, &ext).await;
        fs::rename(&src, &dest).await?;
        let dest_str = dest.to_string_lossy().to_string();
        entries[idx].file_path = Some(dest_str.clone());
        let out = serde_json::to_vec_pretty(&entries)?;
        JsonFile::atomic_write(&self.index_file, out).await?;
        Ok(dest_str)
    }

    /// Move a tab's project file back into `.arris/files/` so it becomes an
    /// internal scratch tab again, then clear the index entry's `file_path`.
    /// Inverse of [`Self::move_to_project`]: the tab returns to its sidebar
    /// section and the sidecar store reclaims ownership of its body. A no-op if
    /// the tab is already a scratch tab.
    pub async fn move_to_scratch(&self, id: &str) -> Result<(), StoreError> {
        let bytes = fs::read(&self.index_file).await?;
        let mut entries: Vec<ConsoleTabIndexEntry> = serde_json::from_slice(&bytes)?;
        let idx = entries
            .iter()
            .position(|e| e.id == id)
            .ok_or_else(|| StoreError::NotFound(id.to_string()))?;
        let Some(file_path) = entries[idx].file_path.clone() else {
            return Ok(());
        };
        let src = self.resolve(&file_path);
        let dest = self.files_dir.join(entries[idx].sidecar_name());
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::rename(&src, &dest).await?;
        entries[idx].file_path = None;
        let out = serde_json::to_vec_pretty(&entries)?;
        JsonFile::atomic_write(&self.index_file, out).await
    }

    fn resolve(&self, file_path: &str) -> PathBuf {
        let p = Path::new(file_path);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            self.project_root.join(p)
        }
    }

    async fn read_body(path: &Path) -> Result<String, StoreError> {
        match fs::read_to_string(path).await {
            Ok(s) => Ok(s),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            Err(err) => Err(err.into()),
        }
    }

    /// Delete sidecar files whose tab no longer exists (e.g. after a tab is
    /// closed), so `.arris/files/` doesn't accumulate orphans.
    async fn prune_sidecars(&self, keep: &HashSet<String>) -> Result<(), StoreError> {
        let mut rd = match fs::read_dir(&self.files_dir).await {
            Ok(rd) => rd,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(err) => return Err(err.into()),
        };
        while let Some(ent) = rd.next_entry().await? {
            let name = ent.file_name().to_string_lossy().to_string();
            if !keep.contains(&name) {
                let _ = fs::remove_file(ent.path()).await;
            }
        }
        Ok(())
    }

    async fn unique_dest(&self, name: &str, ext: &str) -> PathBuf {
        let mut dest = self.project_root.join(format!("{name}.{ext}"));
        let mut n = 2u32;
        while fs::try_exists(&dest).await.unwrap_or(false) {
            dest = self.project_root.join(format!("{name} ({n}).{ext}"));
            n += 1;
        }
        dest
    }

    /// Strip path separators and filesystem-reserved characters from a tab title
    /// so it can be used as a filename.
    fn sanitize_title(title: &str) -> String {
        let cleaned: String = title
            .chars()
            .map(|c| {
                if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
                    || c.is_control()
                {
                    '_'
                } else {
                    c
                }
            })
            .collect();
        let trimmed = cleaned.trim().trim_matches('.').trim();
        if trimmed.is_empty() {
            "untitled".to_string()
        } else {
            trimmed.to_string()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a store rooted at a real `.arris` dir inside `tmp`, so the project
    /// root (its parent) stays inside the tempdir.
    fn store_in(tmp: &Path) -> ConsoleTabsStore {
        ConsoleTabsStore::new(tmp.join(".arris"))
    }

    fn sample_tab() -> PersistedConsoleTab {
        PersistedConsoleTab {
            id: "tab-1".into(),
            title: "Console 1".into(),
            text: "SELECT 1".into(),
            kind: "sql".into(),
            connection_id: None,
            cursor: 0,
            closed: None,
            is_federation: None,
            tab_type: None,
            file_path: None,
            table_ref: None,
            table_editable: None,
            created_at: None,
        }
    }

    #[tokio::test]
    async fn round_trip_persists_text_and_cursor() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let mut tab = sample_tab();
        tab.cursor = 7;
        store.save(&[tab.clone()]).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded, vec![tab]);
    }

    #[tokio::test]
    async fn body_written_to_sidecar_not_inline_in_index() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        store.save(&[sample_tab()]).await.unwrap();

        let sidecar = tmp.path().join(".arris").join("files").join("tab-1.sql");
        assert_eq!(std::fs::read_to_string(&sidecar).unwrap(), "SELECT 1");

        let index = std::fs::read_to_string(tmp.path().join(".arris").join("console_tabs.json")).unwrap();
        assert!(!index.contains("SELECT 1"), "index must not inline the body");
        assert!(!index.contains("\"text\""), "index must not carry a text field");
    }

    #[tokio::test]
    async fn notebook_body_uses_ipynb_sidecar() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let mut tab = sample_tab();
        tab.tab_type = Some("notebook".into());
        tab.kind = "notebook".into();
        tab.text = "{\"cells\":[]}".into();
        store.save(&[tab.clone()]).await.unwrap();
        let sidecar = tmp.path().join(".arris").join("files").join("tab-1.ipynb");
        assert_eq!(std::fs::read_to_string(&sidecar).unwrap(), "{\"cells\":[]}");
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded, vec![tab]);
    }

    #[tokio::test]
    async fn canvas_body_uses_canvas_json_sidecar() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let mut tab = sample_tab();
        tab.tab_type = Some("canvas".into());
        tab.kind = "canvas".into();
        tab.text = "{\"version\":1,\"components\":[],\"edges\":[]}".into();
        store.save(&[tab.clone()]).await.unwrap();
        let sidecar = tmp
            .path()
            .join(".arris")
            .join("files")
            .join("tab-1.canvas.json");
        assert_eq!(
            std::fs::read_to_string(&sidecar).unwrap(),
            "{\"version\":1,\"components\":[],\"edges\":[]}"
        );
        // The board body round-trips: reload returns the same doc, not an empty string.
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded, vec![tab]);
    }

    #[tokio::test]
    async fn console_tab_preserves_tab_type() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let mut tab = sample_tab();
        tab.tab_type = Some("console".into());
        store.save(&[tab.clone()]).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded[0].tab_type.as_deref(), Some("console"));
    }

    #[tokio::test]
    async fn table_tab_preserves_table_ref() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let mut tab = sample_tab();
        tab.title = "sales_transactions".into();
        tab.tab_type = Some("table".into());
        tab.table_ref = Some(TableRef {
            database: None,
            schema: Some("public".into()),
            name: "sales_transactions".into(),
        });
        store.save(&[tab.clone()]).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded[0].tab_type.as_deref(), Some("table"));
        assert_eq!(
            loaded[0].table_ref.as_ref().unwrap().name,
            "sales_transactions"
        );
        assert_eq!(
            loaded[0].table_ref.as_ref().unwrap().schema.as_deref(),
            Some("public")
        );
    }

    #[tokio::test]
    async fn table_tab_preserves_table_editable() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let mut editable = sample_tab();
        editable.tab_type = Some("table".into());
        editable.table_editable = Some(true);
        let mut readonly = sample_tab();
        readonly.id = "tab-2".into();
        readonly.tab_type = Some("table".into());
        readonly.table_editable = Some(false);
        store.save(&[editable.clone(), readonly.clone()]).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded[0].table_editable, Some(true));
        assert_eq!(loaded[1].table_editable, Some(false));
    }

    #[tokio::test]
    async fn table_editable_uses_camel_case_key() {
        let mut tab = sample_tab();
        tab.table_editable = Some(false);
        let json = serde_json::to_string(&tab).unwrap();
        assert!(json.contains("tableEditable"));
        assert!(!json.contains("table_editable"));
    }

    #[tokio::test]
    async fn legacy_json_without_table_editable_deserializes() {
        let tmp = tempfile::tempdir().unwrap();
        let arris = tmp.path().join(".arris");
        std::fs::create_dir_all(&arris).unwrap();
        let json = serde_json::json!([{
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "title": "users",
            "kind": "sql",
            "cursor": 0,
            "tabType": "table"
        }]);
        std::fs::write(arris.join("console_tabs.json"), serde_json::to_vec_pretty(&json).unwrap()).unwrap();
        let store = store_in(tmp.path());
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded[0].table_editable, None);
    }

    #[tokio::test]
    async fn round_trip_persists_created_at() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let mut tab = sample_tab();
        tab.created_at = Some(1714800000000.0);
        store.save(&[tab.clone()]).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded[0].created_at, Some(1714800000000.0));
    }

    #[tokio::test]
    async fn empty_when_file_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        assert!(store.load().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn camel_case_json_keys() {
        let mut tab = sample_tab();
        tab.connection_id = Some("conn-1".into());
        tab.is_federation = Some(true);
        tab.tab_type = Some("console".into());
        tab.file_path = Some("/tmp/test.sql".into());
        tab.created_at = Some(1714800000000.0);
        let json = serde_json::to_string(&tab).unwrap();
        assert!(json.contains("isFederation"));
        assert!(json.contains("tabType"));
        assert!(json.contains("filePath"));
        assert!(json.contains("createdAt"));
        assert!(json.contains("connectionId"));
        assert!(!json.contains("is_federation"));
        assert!(!json.contains("tab_type"));
        assert!(!json.contains("file_path"));
        assert!(!json.contains("created_at"));
        assert!(!json.contains("connection_id"));
    }

    #[tokio::test]
    async fn closing_a_tab_prunes_its_sidecar() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let mut a = sample_tab();
        let mut b = sample_tab();
        b.id = "tab-2".into();
        store.save(&[a.clone(), b.clone()]).await.unwrap();
        let files = tmp.path().join(".arris").join("files");
        assert!(files.join("tab-1.sql").exists());
        assert!(files.join("tab-2.sql").exists());

        a.text = "SELECT 2".into();
        store.save(&[a]).await.unwrap();
        assert!(files.join("tab-1.sql").exists());
        assert!(!files.join("tab-2.sql").exists(), "orphan sidecar should be pruned");
    }

    #[tokio::test]
    async fn move_to_project_relocates_file_and_sets_file_path() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        store.save(&[sample_tab()]).await.unwrap();

        let dest = store.move_to_project("tab-1").await.unwrap();
        assert_eq!(dest, tmp.path().join("Console 1.sql").to_string_lossy());
        assert!(tmp.path().join("Console 1.sql").exists());
        assert!(!tmp.path().join(".arris").join("files").join("tab-1.sql").exists());

        let loaded = store.load().await.unwrap();
        assert_eq!(loaded[0].file_path.as_deref(), Some(dest.as_str()));
        assert_eq!(loaded[0].text, "SELECT 1");
    }

    #[tokio::test]
    async fn move_to_project_dedupes_on_name_collision() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        // A pre-existing project file with the same name as the tab's title.
        std::fs::write(tmp.path().join("Console 1.sql"), "existing").unwrap();
        store.save(&[sample_tab()]).await.unwrap();

        let dest = store.move_to_project("tab-1").await.unwrap();
        assert_eq!(dest, tmp.path().join("Console 1 (2).sql").to_string_lossy());
        assert_eq!(std::fs::read_to_string(tmp.path().join("Console 1.sql")).unwrap(), "existing");
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "SELECT 1");
    }

    #[tokio::test]
    async fn move_to_project_errors_on_unknown_id() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        store.save(&[sample_tab()]).await.unwrap();
        let err = store.move_to_project("nope").await.unwrap_err();
        assert!(matches!(err, StoreError::NotFound(_)));
    }

    #[tokio::test]
    async fn move_to_scratch_relocates_file_back_and_clears_file_path() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        store.save(&[sample_tab()]).await.unwrap();
        let dest = store.move_to_project("tab-1").await.unwrap();
        assert!(std::path::Path::new(&dest).exists());

        store.move_to_scratch("tab-1").await.unwrap();
        // The project file is gone; the body is back under .arris/files.
        assert!(!std::path::Path::new(&dest).exists());
        assert!(tmp.path().join(".arris").join("files").join("tab-1.sql").exists());

        let loaded = store.load().await.unwrap();
        assert_eq!(loaded[0].file_path, None);
        assert_eq!(loaded[0].text, "SELECT 1");
    }

    #[tokio::test]
    async fn move_to_scratch_is_noop_for_already_scratch_tab() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        store.save(&[sample_tab()]).await.unwrap();
        store.move_to_scratch("tab-1").await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded[0].file_path, None);
        assert_eq!(loaded[0].text, "SELECT 1");
    }

    #[tokio::test]
    async fn move_to_scratch_errors_on_unknown_id() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        store.save(&[sample_tab()]).await.unwrap();
        let err = store.move_to_scratch("nope").await.unwrap_err();
        assert!(matches!(err, StoreError::NotFound(_)));
    }

    #[tokio::test]
    async fn file_backed_tab_reads_body_from_its_path() {
        let tmp = tempfile::tempdir().unwrap();
        let store = store_in(tmp.path());
        let file = tmp.path().join("query.sql");
        std::fs::write(&file, "SELECT 42").unwrap();
        let mut tab = sample_tab();
        tab.tab_type = Some("console".into());
        tab.file_path = Some(file.to_string_lossy().to_string());
        // The blob body is ignored for file-backed tabs; the file is the source.
        tab.text = "stale".into();
        store.save(&[tab.clone()]).await.unwrap();
        // No sidecar should be written for a file-backed tab.
        assert!(!tmp.path().join(".arris").join("files").join("tab-1.sql").exists());
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded[0].text, "SELECT 42");
    }
}
