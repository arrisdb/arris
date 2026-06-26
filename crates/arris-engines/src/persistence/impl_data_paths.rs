//! XDG-aware data directory resolution. Resolves the Arris
//! `Application Support/app.arrisdb.desktop/` location on macOS while staying portable.

use std::path::{Path, PathBuf};

use directories::ProjectDirs;

use super::PathError;

/// Namespace for OS data-directory resolution.
pub struct DataPaths;

impl DataPaths {
    fn project_dirs() -> Option<ProjectDirs> {
        ProjectDirs::from("app", "arrisdb", "desktop")
    }

    pub fn data_dir() -> Result<PathBuf, PathError> {
        let p = Self::project_dirs().ok_or(PathError::NotResolvable)?;
        Ok(p.data_dir().to_path_buf())
    }

    pub fn project_data_dir(project_root: &Path) -> PathBuf {
        project_root.join(".arris")
    }

    pub fn ensure_project_data_dir(project_root: &Path) -> Result<PathBuf, PathError> {
        let dir = Self::project_data_dir(project_root);
        std::fs::create_dir_all(&dir).map_err(|_| PathError::NotResolvable)?;
        Ok(dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_dir_returns_some_path() {
        let p = DataPaths::data_dir().unwrap();
        assert!(!p.as_os_str().is_empty());
    }

    #[test]
    fn project_data_dir_returns_arris_subdir() {
        let root = Path::new("/tmp/myproject");
        let p = DataPaths::project_data_dir(root);
        assert_eq!(p, PathBuf::from("/tmp/myproject/.arris"));
    }

    #[test]
    fn ensure_project_data_dir_creates_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let arris_dir = DataPaths::ensure_project_data_dir(tmp.path()).unwrap();
        assert!(arris_dir.is_dir());
        assert_eq!(arris_dir, tmp.path().join(".arris"));
    }
}
