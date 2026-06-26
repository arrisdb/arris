pub(super) const FOLDER_TREE_MAX_DEPTH: usize = 6;
pub(super) const FOLDER_TREE_MAX_ENTRIES_PER_DIR: usize = 500;
pub(super) const READ_TEXT_FILE_MAX_BYTES: u64 = 4 * 1024 * 1024;
pub(super) const READ_BINARY_FILE_MAX_BYTES: u64 = 25 * 1024 * 1024;

/// Directory names hidden from the file tree by default. Users override this
/// list via the `fileTreeSkipDirs` preference, so it is only the seed value.
pub const DEFAULT_SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    "__pycache__",
    ".venv",
    "venv",
    ".idea",
    ".vscode",
    ".DS_Store",
    ".pytest_cache",
    ".mypy_cache",
    ".dbt",
    "logs",
];
