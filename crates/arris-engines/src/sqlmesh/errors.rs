use std::io;
use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SqlMeshError {
    #[error("yaml parse failed: {0}")]
    Parse(#[from] serde_yml::Error),
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("config.yaml not found at {0}")]
    ConfigMissing(PathBuf),
    #[error("not a SQLMesh project: {0} has no SQLMesh configuration keys")]
    NotSqlMeshProject(PathBuf),
}

#[derive(Debug, Error)]
pub enum SqlMeshCliError {
    #[error("sqlmesh executable not found")]
    NotFound,
    #[error("sqlmesh command failed (exit {exit_code}): {stderr}")]
    CommandFailed { exit_code: i32, stderr: String },
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("rendered SQL not returned by sqlmesh render")]
    RenderEmpty,
}
