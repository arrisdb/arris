use std::path::{Path, PathBuf};

use crate::persistence::DataPaths;

use super::errors::PythonError;
use super::types::{InterpreterSource, PythonInterpreter};
use super::impl_venv::Venv;

/// Persists user-created venv interpreter paths so they survive app restarts.
/// Discovery (PATH / pyenv / common dirs) never finds a venv tucked under an
/// arbitrary directory, so we remember the ones we created.
pub(super) struct VenvRegistry;

impl VenvRegistry {
    const FILE: &'static str = "python_venvs.json";

    fn path() -> Result<PathBuf, PythonError> {
        let dir = DataPaths::data_dir().map_err(|e| PythonError::Persist(e.to_string()))?;
        Ok(dir.join(Self::FILE))
    }

    /// De-duplicating append: keep existing order, add `python` if absent. Pure.
    pub(super) fn merge_paths(existing: Vec<PathBuf>, python: &Path) -> Vec<PathBuf> {
        let mut out = existing;
        if !out.iter().any(|p| p == python) {
            out.push(python.to_path_buf());
        }
        out
    }

    /// Load the registered paths, returning an empty list on any read/parse error
    /// (a missing or corrupt registry is not fatal — discovery still works).
    pub(super) fn load() -> Vec<PathBuf> {
        let Ok(path) = Self::path() else {
            return Vec::new();
        };
        let Ok(bytes) = std::fs::read(&path) else {
            return Vec::new();
        };
        serde_json::from_slice(&bytes).unwrap_or_default()
    }

    /// Remember a newly created venv interpreter. Surfaces write failures so the
    /// caller can report that persistence (not venv creation) failed.
    pub(super) fn add(python: &Path) -> Result<(), PythonError> {
        let path = Self::path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let merged = Self::merge_paths(Self::load(), python);
        let bytes = serde_json::to_vec_pretty(&merged)
            .map_err(|e| PythonError::Persist(e.to_string()))?;
        std::fs::write(&path, bytes)?;
        Ok(())
    }

    /// Resolve registered paths to live interpreters, dropping any that no longer
    /// exist or fail to report a version.
    pub(super) fn interpreters() -> Vec<PythonInterpreter> {
        Self::load()
            .into_iter()
            .filter_map(|p| Venv::interpreter_at(&p, InterpreterSource::Venv))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_paths_appends_new() {
        let existing = vec![PathBuf::from("/a/python")];
        let merged = VenvRegistry::merge_paths(existing, Path::new("/b/python"));
        assert_eq!(
            merged,
            vec![PathBuf::from("/a/python"), PathBuf::from("/b/python")]
        );
    }

    #[test]
    fn merge_paths_dedupes_existing() {
        let existing = vec![PathBuf::from("/a/python")];
        let merged = VenvRegistry::merge_paths(existing, Path::new("/a/python"));
        assert_eq!(merged, vec![PathBuf::from("/a/python")]);
    }
}
