//! XDG-aware data directory resolution. Resolves the Arris
//! `Application Support/app.arrisdb.desktop/` location on macOS while staying portable.

use std::path::{Path, PathBuf};

use directories::ProjectDirs;
use sha2::{Digest, Sha256};

use super::constants::{PROJECT_KEY_HEX_LEN, PROJECT_MANIFEST_FILE, PROJECTS_DIR_NAME};
use super::{PathError, ProjectManifest};

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

    pub fn project_data_dir(base: &Path, project_root: &Path) -> Result<PathBuf, PathError> {
        Ok(Self::key_dir(base, &project_root.canonicalize()?))
    }

    pub fn ensure_project_data_dir(base: &Path, project_root: &Path) -> Result<PathBuf, PathError> {
        let root = project_root.canonicalize()?;
        let dir = Self::key_dir(base, &root);
        std::fs::create_dir_all(&dir)?;
        let manifest = ProjectManifest {
            root,
            key: Self::project_key(&dir),
        };
        std::fs::write(
            dir.join(PROJECT_MANIFEST_FILE),
            serde_json::to_vec_pretty(&manifest)?,
        )?;
        Ok(dir)
    }

    /// Unreadable or malformed entries are skipped so one bad dir cannot hide the rest.
    pub fn list_projects(base: &Path) -> Vec<ProjectManifest> {
        let Ok(entries) = std::fs::read_dir(base.join(PROJECTS_DIR_NAME)) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter_map(|e| std::fs::read(e.path().join(PROJECT_MANIFEST_FILE)).ok())
            .filter_map(|bytes| serde_json::from_slice(&bytes).ok())
            .collect()
    }

    fn key_dir(base: &Path, canonical_root: &Path) -> PathBuf {
        let digest = Sha256::digest(canonical_root.to_string_lossy().as_bytes());
        let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
        base.join(PROJECTS_DIR_NAME)
            .join(&hex[..PROJECT_KEY_HEX_LEN])
    }

    fn project_key(dir: &Path) -> String {
        dir.file_name().unwrap_or_default().to_string_lossy().into_owned()
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
    fn project_data_dir_is_under_base_projects() {
        let base = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let p = DataPaths::project_data_dir(base.path(), root.path()).unwrap();
        assert!(p.starts_with(base.path().join(PROJECTS_DIR_NAME)));
        assert_eq!(p.file_name().unwrap().len(), PROJECT_KEY_HEX_LEN);
    }

    #[test]
    fn project_data_dir_is_stable_for_same_root() {
        let base = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        assert_eq!(
            DataPaths::project_data_dir(base.path(), root.path()).unwrap(),
            DataPaths::project_data_dir(base.path(), root.path()).unwrap()
        );
    }

    #[test]
    fn project_data_dir_differs_for_different_roots() {
        let base = tempfile::tempdir().unwrap();
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        assert_ne!(
            DataPaths::project_data_dir(base.path(), a.path()).unwrap(),
            DataPaths::project_data_dir(base.path(), b.path()).unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    fn project_data_dir_same_for_symlinked_root() {
        let base = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let links = tempfile::tempdir().unwrap();
        let link = links.path().join("link");
        std::os::unix::fs::symlink(root.path(), &link).unwrap();
        assert_eq!(
            DataPaths::project_data_dir(base.path(), root.path()).unwrap(),
            DataPaths::project_data_dir(base.path(), &link).unwrap()
        );
    }

    #[test]
    fn ensure_project_data_dir_creates_directory() {
        let base = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let dir = DataPaths::ensure_project_data_dir(base.path(), root.path()).unwrap();
        assert!(dir.is_dir());
        assert!(dir.join(PROJECT_MANIFEST_FILE).is_file());
    }

    #[test]
    fn list_projects_returns_manifests_written_by_ensure() {
        let base = tempfile::tempdir().unwrap();
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        DataPaths::ensure_project_data_dir(base.path(), a.path()).unwrap();
        DataPaths::ensure_project_data_dir(base.path(), b.path()).unwrap();
        let roots: Vec<PathBuf> = DataPaths::list_projects(base.path())
            .into_iter()
            .map(|m| m.root)
            .collect();
        assert_eq!(roots.len(), 2);
        assert!(roots.contains(&a.path().canonicalize().unwrap()));
        assert!(roots.contains(&b.path().canonicalize().unwrap()));
    }

    #[test]
    fn ensure_rejects_nonexistent_root() {
        let base = tempfile::tempdir().unwrap();
        let missing = base.path().join("does-not-exist");
        assert!(DataPaths::ensure_project_data_dir(base.path(), &missing).is_err());
        assert!(DataPaths::project_data_dir(base.path(), &missing).is_err());
        assert!(!base.path().join(PROJECTS_DIR_NAME).exists());
    }

    #[test]
    fn list_projects_empty_when_base_missing() {
        let base = tempfile::tempdir().unwrap();
        assert!(DataPaths::list_projects(&base.path().join("nope")).is_empty());
    }
}
