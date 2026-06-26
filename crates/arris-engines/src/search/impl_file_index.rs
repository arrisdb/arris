use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use nucleo::Matcher;
use nucleo::pattern::{CaseMatching, Normalization, Pattern};
use rusqlite::{Connection, params};

use super::{ContentMatch, FileMatch, ScannedFile, SearchEngine, SearchError};

const MAX_DB_SIZE: u64 = 200 * 1024 * 1024;

pub struct FileIndex {
    db: Connection,
    root: PathBuf,
    file_paths: Vec<String>,
    nucleo: Matcher,
}

impl FileIndex {
    pub fn open(root: PathBuf) -> Result<Self, SearchError> {
        let arris_dir = root.join(".arris");
        fs::create_dir_all(&arris_dir)?;

        let db_path = arris_dir.join("search.db");
        let db = Connection::open(&db_path)?;

        db.execute_batch("PRAGMA foreign_keys = ON;")?;
        db.execute_batch("PRAGMA journal_mode = WAL;")?;

        db.execute_batch(
            "CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                mtime_ns INTEGER NOT NULL,
                size INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS lines (
                file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                line_num INTEGER NOT NULL,
                content TEXT NOT NULL,
                PRIMARY KEY (file_id, line_num)
            );
            CREATE INDEX IF NOT EXISTS idx_lines_content ON lines(content);",
        )?;

        let matcher = Matcher::new(nucleo::Config::DEFAULT);

        let mut idx = Self {
            db,
            root,
            file_paths: Vec::new(),
            nucleo: matcher,
        };

        idx.rebuild()?;

        Ok(idx)
    }

    pub fn rebuild(&mut self) -> Result<(), SearchError> {
        let scanned = SearchEngine::scan_dir(&self.root);

        // Build a map of scanned files for quick lookup
        let scanned_map: HashMap<&str, &ScannedFile> =
            scanned.iter().map(|f| (f.path.as_str(), f)).collect();

        // Load existing DB entries
        let existing: Vec<(i64, String, u64)> = {
            let mut stmt = self.db.prepare("SELECT id, path, mtime_ns FROM files")?;
            stmt.query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get::<_, i64>(2)? as u64))
            })?
            .filter_map(|r| r.ok())
            .collect()
        };

        let existing_map: HashMap<&str, (i64, u64)> = existing
            .iter()
            .map(|(id, path, mtime)| (path.as_str(), (*id, *mtime)))
            .collect();

        // Delete removed files
        for (id, path, _) in &existing {
            if !scanned_map.contains_key(path.as_str()) {
                self.db
                    .execute("DELETE FROM files WHERE id = ?1", params![id])?;
            }
        }

        // Upsert changed/new files
        for sf in &scanned {
            let needs_update = match existing_map.get(sf.path.as_str()) {
                Some((_, old_mtime)) => *old_mtime != sf.mtime_ns,
                None => true,
            };

            if needs_update {
                // Delete old entry if exists
                self.db
                    .execute("DELETE FROM files WHERE path = ?1", params![sf.path])?;

                // Insert new file
                self.db.execute(
                    "INSERT INTO files (path, mtime_ns, size) VALUES (?1, ?2, ?3)",
                    params![sf.path, sf.mtime_ns as i64, sf.size as i64],
                )?;
                let file_id = self.db.last_insert_rowid();

                // Insert lines
                {
                    let mut insert_line = self.db.prepare(
                        "INSERT INTO lines (file_id, line_num, content) VALUES (?1, ?2, ?3)",
                    )?;
                    for (i, line) in sf.lines.iter().enumerate() {
                        insert_line.execute(params![file_id, (i + 1) as i64, line])?;
                    }
                }
            }
        }

        // Refresh file_paths
        self.file_paths = self.load_file_paths()?;

        // Enforce DB size limit
        self.enforce_db_size_limit()?;

        Ok(())
    }

    pub fn search_files(&mut self, query: &str, limit: usize) -> Vec<FileMatch> {
        if query.is_empty() {
            return Vec::new();
        }

        let pattern = Pattern::parse(query, CaseMatching::Smart, Normalization::Smart);
        let mut matches: Vec<FileMatch> = Vec::new();

        for path in &self.file_paths {
            let haystack = nucleo::Utf32String::from(path.as_str());
            if let Some(score) = pattern.score(haystack.slice(..), &mut self.nucleo) {
                let filename = extract_filename(path);
                matches.push(FileMatch {
                    path: path.clone(),
                    filename,
                    score,
                });
            }
        }

        matches.sort_by(|a, b| b.score.cmp(&a.score));
        matches.truncate(limit);
        matches
    }

    pub fn search_content(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ContentMatch>, SearchError> {
        if query.is_empty() {
            return Ok(Vec::new());
        }

        let escaped = query.replace('%', "\\%").replace('_', "\\_");
        let like_pattern = format!("%{escaped}%");

        let mut stmt = self.db.prepare(
            "SELECT f.path, l.line_num, l.content \
             FROM lines l JOIN files f ON l.file_id = f.id \
             WHERE l.content LIKE ?1 ESCAPE '\\' \
             LIMIT ?2",
        )?;

        let query_lower = query.to_lowercase();

        let results: Vec<ContentMatch> = stmt
            .query_map(params![like_pattern, limit as i64], |row| {
                let path: String = row.get(0)?;
                let line_num: i64 = row.get(1)?;
                let line_content: String = row.get(2)?;

                let filename = extract_filename(&path);

                let lower_content = line_content.to_lowercase();
                let (match_start, match_end) = match lower_content.find(&query_lower) {
                    Some(pos) => (pos, pos + query.len()),
                    None => (0, 0),
                };

                Ok(ContentMatch {
                    path,
                    filename,
                    line_num: line_num as usize,
                    line_content,
                    match_start,
                    match_end,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(results)
    }

    pub fn shutdown(self) {
        // Connection closes automatically on drop
    }

    fn load_file_paths(&self) -> Result<Vec<String>, SearchError> {
        let mut stmt = self.db.prepare("SELECT path FROM files ORDER BY path")?;
        let paths: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(paths)
    }

    fn enforce_db_size_limit(&mut self) -> Result<(), SearchError> {
        let db_path = self.root.join(".arris/search.db");
        let db_size = fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);

        if db_size <= MAX_DB_SIZE {
            return Ok(());
        }

        tracing::warn!(
            db_size_mb = db_size / (1024 * 1024),
            "DB exceeds size limit, pruning files with most lines"
        );

        // Find files with the most lines and delete them until under limit
        loop {
            let current_size = fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
            if current_size <= MAX_DB_SIZE {
                break;
            }

            let heaviest: Option<i64> = self
                .db
                .query_row(
                    "SELECT file_id FROM lines GROUP BY file_id ORDER BY COUNT(*) DESC LIMIT 1",
                    [],
                    |row| row.get(0),
                )
                .ok();

            match heaviest {
                Some(file_id) => {
                    self.db
                        .execute("DELETE FROM files WHERE id = ?1", params![file_id])?;
                }
                None => break,
            }
        }

        self.file_paths = self.load_file_paths()?;
        Ok(())
    }
}

fn extract_filename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[cfg(test)]
impl FileIndex {
    fn add_or_update_file(&mut self, rel_path: &str) -> Result<(), SearchError> {
        let full_path = self.root.join(rel_path);
        let meta = fs::metadata(&full_path)?;
        let bytes = fs::read(&full_path)?;

        let content = match std::str::from_utf8(&bytes) {
            Ok(s) => s,
            Err(_) => return Ok(()),
        };

        self.db
            .execute("DELETE FROM files WHERE path = ?1", params![rel_path])?;

        let mtime_ns = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos() as i64)
            .unwrap_or(0);

        self.db.execute(
            "INSERT INTO files (path, mtime_ns, size) VALUES (?1, ?2, ?3)",
            params![rel_path, mtime_ns, meta.len() as i64],
        )?;
        let file_id = self.db.last_insert_rowid();

        let mut insert_line = self
            .db
            .prepare("INSERT INTO lines (file_id, line_num, content) VALUES (?1, ?2, ?3)")?;
        for (i, line) in content.lines().enumerate() {
            insert_line.execute(params![file_id, (i + 1) as i64, line])?;
        }

        self.file_paths = self.load_file_paths()?;
        Ok(())
    }

    fn remove_file(&mut self, rel_path: &str) -> Result<(), SearchError> {
        self.db
            .execute("DELETE FROM files WHERE path = ?1", params![rel_path])?;
        self.file_paths = self.load_file_paths()?;
        Ok(())
    }

    fn stats(&self) -> Result<super::IndexStats, SearchError> {
        let file_count: usize = self
            .db
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))?;
        let line_count: usize = self
            .db
            .query_row("SELECT COUNT(*) FROM lines", [], |row| row.get(0))?;

        let db_path = self.root.join(".arris/search.db");
        let db_size_bytes = fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);

        Ok(super::IndexStats {
            file_count,
            line_count,
            db_size_bytes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup_test_dir() -> TempDir {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        fs::write(
            root.join("main.rs"),
            "fn main() {\n    println!(\"hello\");\n}\n",
        )
        .unwrap();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/lib.rs"), "pub mod utils;\n").unwrap();
        fs::write(
            root.join("src/utils.rs"),
            "pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n",
        )
        .unwrap();

        tmp
    }

    #[test]
    fn open_and_stats() {
        let tmp = setup_test_dir();
        let idx = FileIndex::open(tmp.path().to_path_buf()).unwrap();
        let stats = idx.stats().unwrap();
        assert_eq!(stats.file_count, 3);
        assert!(stats.line_count > 0);
        assert!(stats.db_size_bytes > 0);
    }

    #[test]
    fn search_files_finds_match() {
        let tmp = setup_test_dir();
        let mut idx = FileIndex::open(tmp.path().to_path_buf()).unwrap();
        let results = idx.search_files("main", 10);
        assert!(!results.is_empty());
        assert_eq!(results[0].filename, "main.rs");
    }

    #[test]
    fn search_files_empty_query() {
        let tmp = setup_test_dir();
        let mut idx = FileIndex::open(tmp.path().to_path_buf()).unwrap();
        let results = idx.search_files("", 10);
        assert!(results.is_empty());
    }

    #[test]
    fn search_files_respects_limit() {
        let tmp = setup_test_dir();
        let mut idx = FileIndex::open(tmp.path().to_path_buf()).unwrap();
        let results = idx.search_files("rs", 1);
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn search_content_finds_match() {
        let tmp = setup_test_dir();
        let idx = FileIndex::open(tmp.path().to_path_buf()).unwrap();
        let results = idx.search_content("println", 10).unwrap();
        assert!(!results.is_empty());
        assert!(results[0].line_content.contains("println"));
        assert!(results[0].match_start < results[0].match_end);
    }

    #[test]
    fn search_content_empty_query() {
        let tmp = setup_test_dir();
        let idx = FileIndex::open(tmp.path().to_path_buf()).unwrap();
        let results = idx.search_content("", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn search_content_case_insensitive() {
        let tmp = setup_test_dir();
        let idx = FileIndex::open(tmp.path().to_path_buf()).unwrap();
        let results = idx.search_content("PRINTLN", 10).unwrap();
        assert!(!results.is_empty());
    }

    #[test]
    fn search_content_escapes_wildcards() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("test.txt"), "100% done\nall_good\n").unwrap();
        let idx = FileIndex::open(tmp.path().to_path_buf()).unwrap();

        let results = idx.search_content("100%", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].line_content.contains("100%"));

        let results = idx.search_content("all_", 10).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn add_or_update_file() {
        let tmp = setup_test_dir();
        let mut idx = FileIndex::open(tmp.path().to_path_buf()).unwrap();

        // Create a new file
        fs::write(tmp.path().join("new.txt"), "new content\n").unwrap();
        idx.add_or_update_file("new.txt").unwrap();

        let stats = idx.stats().unwrap();
        assert_eq!(stats.file_count, 4);

        let results = idx.search_content("new content", 10).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn remove_file() {
        let tmp = setup_test_dir();
        let mut idx = FileIndex::open(tmp.path().to_path_buf()).unwrap();

        let before = idx.stats().unwrap().file_count;
        idx.remove_file("main.rs").unwrap();
        let after = idx.stats().unwrap().file_count;
        assert_eq!(after, before - 1);

        let results = idx.search_content("println", 10).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn rebuild_detects_changes() {
        let tmp = setup_test_dir();
        let mut idx = FileIndex::open(tmp.path().to_path_buf()).unwrap();

        // Delete a file on disk and rebuild
        fs::remove_file(tmp.path().join("main.rs")).unwrap();
        idx.rebuild().unwrap();

        let stats = idx.stats().unwrap();
        assert_eq!(stats.file_count, 2);
    }

    #[test]
    fn shutdown_is_clean() {
        let tmp = setup_test_dir();
        let idx = FileIndex::open(tmp.path().to_path_buf()).unwrap();
        idx.shutdown();
        // No panic = success
    }

    #[test]
    fn extract_filename_works() {
        assert_eq!(extract_filename("src/lib.rs"), "lib.rs");
        assert_eq!(extract_filename("main.rs"), "main.rs");
        assert_eq!(extract_filename("a/b/c/deep.txt"), "deep.txt");
    }
}
