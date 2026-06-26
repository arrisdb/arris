pub(super) const MAX_FILE_SIZE: u64 = 256 * 1024;
pub(super) const MAX_FILES: usize = 20_000;
pub(super) const BINARY_CHECK_SIZE: usize = 8 * 1024;

pub(super) const SKIP_DIRS: &[&str] = &[
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
    ".pytest_cache",
    ".mypy_cache",
    ".dbt",
    "logs",
    ".DS_Store",
    ".arris",
];
