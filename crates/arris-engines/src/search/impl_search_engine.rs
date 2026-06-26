use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use crate::Engine;
use super::constants::{BINARY_CHECK_SIZE, MAX_FILES, MAX_FILE_SIZE, SKIP_DIRS};
use super::impl_file_index::FileIndex;
use super::*;

pub struct SearchEngine {
    index: Mutex<Option<FileIndex>>,
}

impl SearchEngine {
    pub fn new() -> Self {
        Self {
            index: Mutex::new(None),
        }
    }

    pub fn scan_tree(&self, root: &Path) -> Vec<ScannedFile> {
        Self::scan_dir(root)
    }

    pub fn open_index(&self, root: PathBuf) -> Result<(), SearchError> {
        let idx = FileIndex::open(root)?;
        let mut guard = self.index.lock().map_err(|e| SearchError::Lock(e.to_string()))?;
        *guard = Some(idx);
        Ok(())
    }

    pub fn close_index(&self) -> Result<(), SearchError> {
        let mut guard = self.index.lock().map_err(|e| SearchError::Lock(e.to_string()))?;
        if let Some(idx) = guard.take() {
            idx.shutdown();
        }
        Ok(())
    }

    pub fn search_files(&self, query: &str, limit: usize) -> Result<Vec<FileMatch>, SearchError> {
        let mut guard = self.index.lock().map_err(|e| SearchError::Lock(e.to_string()))?;
        let idx = guard.as_mut().ok_or(SearchError::NoIndexOpen)?;
        Ok(idx.search_files(query, limit))
    }

    pub fn search_content(&self, query: &str, limit: usize) -> Result<Vec<ContentMatch>, SearchError> {
        let guard = self.index.lock().map_err(|e| SearchError::Lock(e.to_string()))?;
        let idx = guard.as_ref().ok_or(SearchError::NoIndexOpen)?;
        idx.search_content(query, limit)
    }

    pub fn start_watcher(&self, root: &Path) -> Result<FileWatcher, notify::Error> {
        FileWatcher::start(root)
    }
}

impl SearchEngine {
    pub(super) fn scan_dir(root: &Path) -> Vec<ScannedFile> {
        let mut files = Vec::new();
        Self::walk_dir(root, root, &mut files);

        if files.len() > MAX_FILES {
            files.sort_by(|a, b| b.mtime_ns.cmp(&a.mtime_ns));
            files.truncate(MAX_FILES);
        }

        files.sort_by(|a, b| a.path.cmp(&b.path));
        files
    }

    fn walk_dir(root: &Path, dir: &Path, out: &mut Vec<ScannedFile>) {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();

            if SKIP_DIRS.contains(&name.as_ref()) {
                continue;
            }

            if path.is_dir() {
                Self::walk_dir(root, &path, out);
                continue;
            }

            if !path.is_file() {
                continue;
            }

            let meta = match fs::metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };

            if meta.len() > MAX_FILE_SIZE {
                continue;
            }

            let mtime_ns = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(0);

            let bytes = match fs::read(&path) {
                Ok(b) => b,
                Err(_) => continue,
            };

            let check_len = bytes.len().min(BINARY_CHECK_SIZE);
            if bytes[..check_len].contains(&0) {
                continue;
            }

            let content = match std::str::from_utf8(&bytes) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let rel = match path.strip_prefix(root) {
                Ok(r) => r.to_string_lossy().to_string(),
                Err(_) => continue,
            };

            let lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

            out.push(ScannedFile {
                path: rel,
                mtime_ns,
                size: meta.len(),
                lines,
            });
        }
    }
}

impl Engine for SearchEngine {
    fn name(&self) -> &str {
        "search"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn search_engine_scan_tree_finds_files() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join("hello.txt"), "line1\nline2\n").unwrap();
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("sub/nested.txt"), "nested").unwrap();

        let engine = SearchEngine::new();
        let files = engine.scan_tree(root);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "hello.txt");
        assert_eq!(files[1].path, "sub/nested.txt");
    }

    #[test]
    fn search_engine_open_index_and_search_files() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(
            root.join("main.rs"),
            "fn main() {\n    println!(\"hello\");\n}\n",
        )
        .unwrap();

        let engine = SearchEngine::new();
        engine.open_index(root.to_path_buf()).unwrap();

        let results = engine.search_files("main", 10).unwrap();
        assert!(!results.is_empty());
        assert_eq!(results[0].filename, "main.rs");
    }

    #[test]
    fn search_engine_search_content() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(
            root.join("main.rs"),
            "fn main() {\n    println!(\"hello\");\n}\n",
        )
        .unwrap();

        let engine = SearchEngine::new();
        engine.open_index(root.to_path_buf()).unwrap();

        let results = engine.search_content("println", 10).unwrap();
        assert!(!results.is_empty());
        assert!(results[0].line_content.contains("println"));
    }

    #[test]
    fn search_engine_close_index() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        fs::write(root.join("test.txt"), "content").unwrap();

        let engine = SearchEngine::new();
        engine.open_index(root.to_path_buf()).unwrap();
        engine.close_index().unwrap();

        let err = engine.search_files("test", 10).unwrap_err();
        assert!(matches!(err, SearchError::NoIndexOpen));
    }

    #[test]
    fn search_engine_search_without_index_errors() {
        let engine = SearchEngine::new();
        let err = engine.search_files("query", 10).unwrap_err();
        assert!(matches!(err, SearchError::NoIndexOpen));

        let err = engine.search_content("query", 10).unwrap_err();
        assert!(matches!(err, SearchError::NoIndexOpen));
    }

    #[test]
    fn search_engine_close_without_open_is_ok() {
        let engine = SearchEngine::new();
        engine.close_index().unwrap();
    }

    #[test]
    fn search_engine_start_watcher() {
        let tmp = TempDir::new().unwrap();
        let engine = SearchEngine::new();
        let watcher = engine.start_watcher(tmp.path());
        assert!(watcher.is_ok());
        drop(watcher);
    }

    #[test]
    fn search_engine_name() {
        let engine = SearchEngine::new();
        assert_eq!(engine.name(), "search");
    }

    // -- Scanner tests --------------------------------------------------------

    #[test]
    fn scan_tree_basic() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        fs::write(root.join("hello.txt"), "line1\nline2\n").unwrap();
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("sub/nested.txt"), "nested").unwrap();

        let files = SearchEngine::scan_dir(root);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "hello.txt");
        assert_eq!(files[0].lines, vec!["line1", "line2"]);
        assert_eq!(files[1].path, "sub/nested.txt");
        assert_eq!(files[1].lines, vec!["nested"]);
    }

    #[test]
    fn scan_tree_skips_git_dir() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/config"), "gitconfig").unwrap();
        fs::write(root.join("real.txt"), "content").unwrap();

        let files = SearchEngine::scan_dir(root);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "real.txt");
    }

    #[test]
    fn scan_tree_skips_large_files() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let big = vec![b'a'; (MAX_FILE_SIZE + 1) as usize];
        fs::write(root.join("big.txt"), &big).unwrap();
        fs::write(root.join("small.txt"), "ok").unwrap();

        let files = SearchEngine::scan_dir(root);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "small.txt");
    }

    #[test]
    fn scan_tree_skips_binary_files() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        let mut binary = vec![b'h', b'e', b'l', b'l', b'o', 0u8];
        binary.extend_from_slice(b"world");
        fs::write(root.join("binary.bin"), &binary).unwrap();
        fs::write(root.join("text.txt"), "hello").unwrap();

        let files = SearchEngine::scan_dir(root);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "text.txt");
    }

    #[test]
    fn scan_tree_skips_node_modules() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "module").unwrap();
        fs::write(root.join("app.js"), "app").unwrap();

        let files = SearchEngine::scan_dir(root);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "app.js");
    }

    #[test]
    fn scan_tree_sorted_by_path() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        fs::write(root.join("c.txt"), "c").unwrap();
        fs::write(root.join("a.txt"), "a").unwrap();
        fs::write(root.join("b.txt"), "b").unwrap();

        let files = SearchEngine::scan_dir(root);
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["a.txt", "b.txt", "c.txt"]);
    }

    #[test]
    fn scan_tree_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let files = SearchEngine::scan_dir(tmp.path());
        assert!(files.is_empty());
    }
}
