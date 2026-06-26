use std::collections::HashSet;
use std::path::{Path, PathBuf};
use crate::Engine;
use super::constants::{FOLDER_TREE_MAX_DEPTH, FOLDER_TREE_MAX_ENTRIES_PER_DIR, READ_BINARY_FILE_MAX_BYTES, READ_TEXT_FILE_MAX_BYTES};
use super::constants::DEFAULT_SKIP_DIRS;
use super::{FileError, FileTreeEntry};

pub struct FileEngine;

impl FileEngine {
    pub fn new() -> Self {
        Self
    }

    /// The seed list of directory names hidden from the file tree, surfaced so
    /// the frontend's default preference can mirror the backend default.
    pub fn default_skip_dirs() -> Vec<String> {
        DEFAULT_SKIP_DIRS.iter().map(|s| s.to_string()).collect()
    }

    pub fn list_folder_tree(
        &self,
        root: PathBuf,
        skip_dirs: &[String],
    ) -> Result<FileTreeEntry, FileError> {
        if !root.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("{} is not a directory", root.display()),
            ).into());
        }
        let mut tree = Self::read_tree(&root, 0, skip_dirs)?;
        let ignored = Self::git_ignored_set(&root, &tree);
        Self::mark_ignored(&mut tree, &ignored);
        Ok(tree)
    }

    pub fn read_text_file(&self, path: PathBuf) -> Result<String, FileError> {
        let meta = std::fs::metadata(&path)?;
        if !meta.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("{} is not a file", path.display()),
            ).into());
        }
        if meta.len() > READ_TEXT_FILE_MAX_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{} exceeds {} byte limit", path.display(), READ_TEXT_FILE_MAX_BYTES),
            ).into());
        }
        Ok(std::fs::read_to_string(&path)?)
    }

    pub fn read_file_base64(&self, path: PathBuf) -> Result<String, FileError> {
        use base64::Engine as _;
        let meta = std::fs::metadata(&path)?;
        if !meta.is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("{} is not a file", path.display()),
            ).into());
        }
        if meta.len() > READ_BINARY_FILE_MAX_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{} exceeds {} byte limit", path.display(), READ_BINARY_FILE_MAX_BYTES),
            ).into());
        }
        let bytes = std::fs::read(&path)?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    pub fn write_text_file(&self, path: PathBuf, content: String) -> Result<(), FileError> {
        Ok(std::fs::write(&path, content)?)
    }

    pub fn create_file(&self, path: PathBuf) -> Result<(), FileError> {
        if path.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!("{} already exists", path.display()),
            ).into());
        }
        if let Some(parent) = path.parent() {
            if !parent.is_dir() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    format!("parent directory {} does not exist", parent.display()),
                ).into());
            }
        }
        Ok(std::fs::write(&path, "")?)
    }

    pub fn create_folder(&self, path: PathBuf) -> Result<(), FileError> {
        if path.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!("{} already exists", path.display()),
            ).into());
        }
        Ok(std::fs::create_dir(&path)?)
    }

    pub fn rename_entry(&self, from: PathBuf, to: PathBuf) -> Result<(), FileError> {
        if !from.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("{} not found", from.display()),
            ).into());
        }
        if to.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!("{} already exists", to.display()),
            ).into());
        }
        Ok(std::fs::rename(&from, &to)?)
    }

    pub fn delete_entry(&self, path: PathBuf) -> Result<(), FileError> {
        if !path.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("{} not found", path.display()),
            ).into());
        }
        if path.is_dir() {
            Ok(std::fs::remove_dir_all(&path)?)
        } else {
            Ok(std::fs::remove_file(&path)?)
        }
    }

    pub fn copy_entry(&self, from: PathBuf, to: PathBuf) -> Result<(), FileError> {
        if !from.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("{} not found", from.display()),
            ).into());
        }
        if to.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!("{} already exists", to.display()),
            ).into());
        }
        if from.is_dir() {
            Self::copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
        Ok(())
    }

    pub fn move_entry(&self, from: PathBuf, to: PathBuf) -> Result<(), FileError> {
        if !from.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("{} not found", from.display()),
            ).into());
        }
        if to.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!("{} already exists", to.display()),
            ).into());
        }
        std::fs::rename(&from, &to).or_else(|_| {
            self.copy_entry(from.clone(), to.clone())?;
            self.delete_entry(from)?;
            Ok(())
        })
    }

    pub fn duplicate_entry(&self, path: PathBuf) -> Result<PathBuf, FileError> {
        if !path.exists() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("{} not found", path.display()),
            ).into());
        }
        let parent = path.parent().unwrap_or(Path::new("."));
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let ext = path
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_default();
        let mut dest = parent.join(format!("{} copy{}", stem, ext));
        let mut n = 2u32;
        while dest.exists() {
            dest = parent.join(format!("{} copy {}{}", stem, n, ext));
            n += 1;
        }
        if path.is_dir() {
            Self::copy_dir_recursive(&path, &dest)?;
        } else {
            std::fs::copy(&path, &dest)?;
        }
        Ok(dest)
    }
}

impl FileEngine {
    fn read_tree(root: &Path, depth: usize, skip_dirs: &[String]) -> std::io::Result<FileTreeEntry> {
        let name = root
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| root.display().to_string());
        let mut entry = FileTreeEntry {
            name,
            path: root.to_path_buf(),
            is_dir: true,
            git_ignored: false,
            children: Vec::new(),
        };
        if depth >= FOLDER_TREE_MAX_DEPTH {
            return Ok(entry);
        }
        let mut dirs: Vec<FileTreeEntry> = Vec::new();
        let mut files: Vec<FileTreeEntry> = Vec::new();
        let mut count = 0;
        for dirent in std::fs::read_dir(root)? {
            let dirent = match dirent {
                Ok(d) => d,
                Err(_) => continue,
            };
            if count >= FOLDER_TREE_MAX_ENTRIES_PER_DIR {
                break;
            }
            count += 1;
            let path = dirent.path();
            let name = dirent.file_name().to_string_lossy().to_string();
            if skip_dirs.iter().any(|d| d == &name) {
                continue;
            }
            let ft = match dirent.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if ft.is_dir() {
                match Self::read_tree(&path, depth + 1, skip_dirs) {
                    Ok(child) => dirs.push(child),
                    Err(_) => continue,
                }
            } else if ft.is_file() {
                files.push(FileTreeEntry {
                    name,
                    path,
                    is_dir: false,
                    git_ignored: false,
                    children: Vec::new(),
                });
            }
        }
        dirs.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
        files.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
        entry.children.extend(dirs);
        entry.children.extend(files);
        Ok(entry)
    }

    fn collect_paths(entry: &FileTreeEntry, out: &mut Vec<PathBuf>) {
        out.push(entry.path.clone());
        for child in &entry.children {
            Self::collect_paths(child, out);
        }
    }

    fn git_ignored_set(root: &Path, tree: &FileTreeEntry) -> HashSet<PathBuf> {
        let mut paths = Vec::new();
        Self::collect_paths(tree, &mut paths);
        let mut ignored = HashSet::new();
        if paths.is_empty() {
            return ignored;
        }
        let mut child = match std::process::Command::new("git")
            .args(["check-ignore", "--stdin", "-z"])
            .current_dir(root)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(_) => return ignored,
        };
        // Feed stdin from a separate thread while we drain stdout below. Writing
        // every path and only then reading deadlocks once git's output fills the
        // OS pipe buffer (~64KB): git blocks on stdout while we block on stdin.
        let stdin = child.stdin.take();
        let writer = std::thread::spawn(move || {
            if let Some(mut stdin) = stdin {
                use std::io::Write;
                for p in &paths {
                    if write!(stdin, "{}\0", p.display()).is_err() {
                        break;
                    }
                }
                // Dropping stdin closes the pipe, signaling EOF to git.
            }
        });
        let output = child.wait_with_output();
        let _ = writer.join();
        let output = match output {
            Ok(o) => o,
            Err(_) => return ignored,
        };
        if !output.stdout.is_empty() {
            for chunk in output.stdout.split(|&b| b == 0) {
                if !chunk.is_empty() {
                    ignored.insert(PathBuf::from(std::str::from_utf8(chunk).unwrap_or("")));
                }
            }
        }
        ignored
    }

    fn mark_ignored(entry: &mut FileTreeEntry, ignored: &HashSet<PathBuf>) {
        if ignored.contains(&entry.path) {
            Self::mark_all_ignored(entry);
        } else {
            for child in &mut entry.children {
                Self::mark_ignored(child, ignored);
            }
        }
    }

    fn mark_all_ignored(entry: &mut FileTreeEntry) {
        entry.git_ignored = true;
        for child in &mut entry.children {
            Self::mark_all_ignored(child);
        }
    }

    fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
        std::fs::create_dir(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            let target = dst.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                Self::copy_dir_recursive(&entry.path(), &target)?;
            } else {
                std::fs::copy(entry.path(), target)?;
            }
        }
        Ok(())
    }
}

impl Engine for FileEngine {
    fn name(&self) -> &str {
        "file"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> FileEngine {
        FileEngine::new()
    }

    #[test]
    fn list_folder_tree_returns_dirs_first_then_files_sorted() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir(root.join("models")).unwrap();
        std::fs::create_dir(root.join("models").join("marts")).unwrap();
        std::fs::write(root.join("models").join("marts").join("dim_users.sql"), b"--").unwrap();
        std::fs::write(root.join("models").join("marts").join("schema.yml"), b"--").unwrap();
        std::fs::write(root.join("dbt_project.yml"), b"name: x\n").unwrap();
        std::fs::create_dir(root.join("node_modules")).unwrap();
        std::fs::create_dir(root.join(".git")).unwrap();

        let tree = e.list_folder_tree(root.into(), &FileEngine::default_skip_dirs()).unwrap();
        assert!(tree.is_dir);
        let names: Vec<_> = tree.children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["models", "dbt_project.yml"]);
        let marts = &tree.children[0].children[0];
        assert_eq!(marts.name, "marts");
        let marts_kids: Vec<_> = marts.children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(marts_kids, vec!["dim_users.sql", "schema.yml"]);
    }

    #[test]
    fn list_folder_tree_shows_arris_metadata_dir() {
        // `.arris` is shown so users can see (and version-control) their scratch
        // console / notebook sidecars under `.arris/files/`.
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir(root.join(".arris")).unwrap();
        std::fs::write(root.join(".arris").join("console_tabs.json"), b"[]").unwrap();
        std::fs::write(root.join("query.sql"), b"SELECT 1").unwrap();

        let tree = e.list_folder_tree(root.into(), &FileEngine::default_skip_dirs()).unwrap();
        let names: Vec<_> = tree.children.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&".arris"), "expected .arris in {names:?}");
        assert!(names.contains(&"query.sql"), "expected query.sql in {names:?}");
    }

    #[test]
    fn list_folder_tree_honors_custom_skip_dirs() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir(root.join("node_modules")).unwrap();
        std::fs::create_dir(root.join("secret")).unwrap();
        std::fs::write(root.join("query.sql"), b"SELECT 1").unwrap();

        // A custom list that hides `secret` but NOT `node_modules`: the user's
        // list fully replaces the default, so both decisions are theirs.
        let skip = vec!["secret".to_string()];
        let tree = e.list_folder_tree(root.into(), &skip).unwrap();
        let names: Vec<_> = tree.children.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"node_modules"), "node_modules shown: {names:?}");
        assert!(!names.contains(&"secret"), "secret hidden: {names:?}");
        assert!(names.contains(&"query.sql"), "query.sql shown: {names:?}");

        // An empty list hides nothing.
        let all = e.list_folder_tree(root.into(), &[]).unwrap();
        let all_names: Vec<_> = all.children.iter().map(|c| c.name.as_str()).collect();
        assert!(all_names.contains(&"secret"), "empty skip shows all: {all_names:?}");
    }

    #[test]
    fn list_folder_tree_marks_gitignored_files() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::process::Command::new("git")
            .args(["init"])
            .current_dir(root)
            .output()
            .unwrap();
        std::fs::write(root.join(".gitignore"), "ignored.txt\noutput/\n").unwrap();
        std::fs::write(root.join("tracked.sql"), b"SELECT 1").unwrap();
        std::fs::write(root.join("ignored.txt"), b"secret").unwrap();
        std::fs::create_dir(root.join("output")).unwrap();
        std::fs::write(root.join("output").join("out.js"), b"//").unwrap();

        let tree = e.list_folder_tree(root.into(), &FileEngine::default_skip_dirs()).unwrap();
        assert!(!tree.git_ignored);

        let find = |name: &str| -> &FileTreeEntry {
            tree.children
                .iter()
                .find(|c| c.name == name)
                .unwrap_or_else(|| panic!("child {} not found", name))
        };
        assert!(!find(".gitignore").git_ignored);
        assert!(!find("tracked.sql").git_ignored);
        assert!(find("ignored.txt").git_ignored);
        let output_dir = find("output");
        assert!(output_dir.git_ignored);
        assert!(output_dir.children.iter().all(|c| c.git_ignored));
    }

    // Regression: feeding every tree path to `git check-ignore
    // --stdin` while reading its stdout on the same thread deadlocks once git's
    // ignored-path output exceeds the OS pipe buffer (~64KB). Build a repo whose
    // .gitignore matches enough files to blow past that, and require
    // list_folder_tree to finish within a bounded timeout (pre-fix it hangs).
    #[test]
    fn list_folder_tree_does_not_deadlock_on_large_ignored_output() {
        use std::sync::mpsc;
        use std::time::Duration;

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        std::process::Command::new("git")
            .args(["init"])
            .current_dir(&root)
            .output()
            .unwrap();
        std::fs::write(root.join(".gitignore"), "*.tmp\n").unwrap();

        // 12 dirs x 400 files = 4800 ignored paths (~each path 40+ bytes), so
        // git's NUL-separated stdout far exceeds a 64KB pipe buffer. Stay under
        // FOLDER_TREE_MAX_ENTRIES_PER_DIR (500) per dir and the depth cap.
        for d in 0..12 {
            let dir = root.join(format!("sub{d:02}"));
            std::fs::create_dir(&dir).unwrap();
            for f in 0..400 {
                std::fs::write(dir.join(format!("file_{f:04}.tmp")), b"x").unwrap();
            }
        }

        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let tree = FileEngine::new().list_folder_tree(root, &FileEngine::default_skip_dirs());
            let _ = tx.send(tree);
        });

        let tree = match rx.recv_timeout(Duration::from_secs(20)) {
            Ok(result) => result.unwrap(),
            Err(_) => panic!("list_folder_tree deadlocked on large git check-ignore output"),
        };

        let sub = tree
            .children
            .iter()
            .find(|c| c.name == "sub00")
            .expect("sub00 present");
        assert!(sub.children.iter().all(|c| c.git_ignored));
    }

    #[test]
    fn list_folder_tree_no_git_repo_all_false() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::write(root.join("a.txt"), b"hello").unwrap();

        let tree = e.list_folder_tree(root.into(), &FileEngine::default_skip_dirs()).unwrap();
        assert!(!tree.git_ignored);
        assert!(tree.children.iter().all(|c| !c.git_ignored));
    }

    #[test]
    fn list_folder_tree_errors_on_missing_path() {
        let e = engine();
        let err = e
            .list_folder_tree("/nonexistent/path/xyz".into(), &FileEngine::default_skip_dirs())
            .unwrap_err();
        assert!(matches!(err, FileError::Io(_)));
    }

    #[test]
    fn read_text_file_returns_contents() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("a.sql");
        std::fs::write(&path, b"SELECT 1;").unwrap();
        assert_eq!(e.read_text_file(path).unwrap(), "SELECT 1;");
    }

    #[test]
    fn read_file_base64_encodes_bytes() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("pixel.png");
        // Arbitrary binary bytes including non-utf8.
        std::fs::write(&path, [0u8, 159, 146, 150, 255]).unwrap();
        assert_eq!(e.read_file_base64(path).unwrap(), "AJ+Slv8=");
    }

    #[test]
    fn read_file_base64_errors_when_path_is_dir() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let err = e.read_file_base64(tmp.path().into()).unwrap_err();
        assert!(matches!(err, FileError::Io(_)));
    }

    #[test]
    fn read_text_file_errors_when_path_is_dir() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let err = e.read_text_file(tmp.path().into()).unwrap_err();
        assert!(matches!(err, FileError::Io(_)));
    }

    #[test]
    fn create_file_creates_empty_file() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("new.sql");
        e.create_file(path.clone()).unwrap();
        assert!(path.exists());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "");
    }

    #[test]
    fn create_file_errors_when_exists() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("dup.sql");
        std::fs::write(&path, b"x").unwrap();
        let err = e.create_file(path).unwrap_err();
        assert!(matches!(err, FileError::Io(_)));
    }

    #[test]
    fn create_folder_creates_dir() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("sub");
        e.create_folder(path.clone()).unwrap();
        assert!(path.is_dir());
    }

    #[test]
    fn create_folder_errors_when_exists() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let err = e.create_folder(tmp.path().into()).unwrap_err();
        assert!(matches!(err, FileError::Io(_)));
    }

    #[test]
    fn rename_entry_renames_file() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("a.txt");
        let dst = tmp.path().join("b.txt");
        std::fs::write(&src, b"hi").unwrap();
        e.rename_entry(src.clone(), dst.clone()).unwrap();
        assert!(!src.exists());
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "hi");
    }

    #[test]
    fn rename_entry_errors_on_conflict() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        std::fs::write(&a, b"").unwrap();
        std::fs::write(&b, b"").unwrap();
        let err = e.rename_entry(a, b).unwrap_err();
        assert!(matches!(err, FileError::Io(_)));
    }

    #[test]
    fn delete_entry_removes_file() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("x.txt");
        std::fs::write(&path, b"bye").unwrap();
        e.delete_entry(path.clone()).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn delete_entry_removes_dir_recursively() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("sub");
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("f.txt"), b"x").unwrap();
        e.delete_entry(dir.clone()).unwrap();
        assert!(!dir.exists());
    }

    #[test]
    fn copy_entry_copies_file() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src.txt");
        let dst = tmp.path().join("dst.txt");
        std::fs::write(&src, b"data").unwrap();
        e.copy_entry(src.clone(), dst.clone()).unwrap();
        assert!(src.exists());
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "data");
    }

    #[test]
    fn copy_entry_copies_dir_recursively() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("d");
        std::fs::create_dir(&src).unwrap();
        std::fs::write(src.join("f.txt"), b"ok").unwrap();
        let dst = tmp.path().join("d2");
        e.copy_entry(src, dst.clone()).unwrap();
        assert_eq!(std::fs::read_to_string(dst.join("f.txt")).unwrap(), "ok");
    }

    #[test]
    fn move_entry_moves_file() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("m.txt");
        let dst = tmp.path().join("n.txt");
        std::fs::write(&src, b"mv").unwrap();
        e.move_entry(src.clone(), dst.clone()).unwrap();
        assert!(!src.exists());
        assert_eq!(std::fs::read_to_string(&dst).unwrap(), "mv");
    }

    #[test]
    fn duplicate_entry_creates_copy_suffix() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("file.sql");
        std::fs::write(&src, b"dup").unwrap();
        let dup = e.duplicate_entry(src).unwrap();
        assert!(dup.exists());
        assert!(dup.to_string_lossy().contains("file copy.sql"));
        assert_eq!(std::fs::read_to_string(&dup).unwrap(), "dup");
    }

    #[test]
    fn duplicate_entry_increments_counter_on_conflict() {
        let e = engine();
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("f.txt");
        std::fs::write(&src, b"x").unwrap();
        std::fs::write(tmp.path().join("f copy.txt"), b"y").unwrap();
        let dup = e.duplicate_entry(src).unwrap();
        assert!(dup.to_string_lossy().contains("f copy 2.txt"));
    }
}
