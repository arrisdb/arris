use std::io;
use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbtCliError {
    #[error("dbt executable not found")]
    NotFound,
    #[error("dbt command failed (exit {exit_code}): {stderr}")]
    CommandFailed { exit_code: i32, stderr: String },
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("compiled SQL not found in target/compiled")]
    CompiledNotFound,
}

#[derive(Debug, Error)]
pub enum DbtProjectError {
    #[error("dbt_project.yml is empty")]
    Empty,
    #[error("dbt_project.yml missing required field: {0}")]
    MissingField(&'static str),
    #[error("yaml parse failed: {0}")]
    Parse(#[from] serde_yml::Error),
}

#[derive(Debug, Error)]
pub enum ScanError {
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("dbt_project.yml not found at {0}")]
    ProjectFileMissing(PathBuf),
    #[error("dbt_project.yml: {0}")]
    Project(#[from] DbtProjectError),
    #[error("yaml parse: {0}")]
    Yaml(#[from] serde_yml::Error),
}

#[derive(Debug, Error)]
pub enum DbtDocsError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("manifest.json not found at {0}; run `dbt docs generate` first")]
    ManifestNotFound(PathBuf),
    #[error("failed to parse manifest.json: {0}")]
    ManifestParse(String),
    #[error("dbt_project.yml: {0}")]
    Project(#[from] DbtProjectError),
}

#[derive(Debug, Error)]
pub enum DbtRunResultsError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("run_results.json not found at {0}; run dbt first")]
    NotFound(PathBuf),
    #[error("failed to parse run_results.json: {0}")]
    Parse(String),
    #[error("dbt_project.yml: {0}")]
    Project(#[from] DbtProjectError),
}

#[derive(Debug, Error)]
pub enum SlimDiffError {
    #[error("dbt CLI error: {0}")]
    Cli(#[from] DbtCliError),
    #[error("dbt docs error: {0}")]
    Docs(#[from] DbtDocsError),
    #[error("dbt compile failed: {0}")]
    CompileFailed(String),
    #[error("model not found in manifest: {0}; run `dbt docs generate` first")]
    ModelNotFound(String),
    #[error("prod and new outputs share no columns; nothing to diff")]
    NoSharedColumns,
    #[error("primary-key column(s) not present in both prod and new outputs: {0}")]
    KeyColumnNotShared(String),
    #[error("connection not found: {0}")]
    ConnectionNotFound(uuid::Uuid),
    #[error("data diff is not available for this data source: {0:?}")]
    UnsupportedSource(crate::DatabaseKind),
    #[error("query error: {0}")]
    Query(String),
}

#[derive(Debug, Error)]
pub enum ColumnLineageError {
    #[error("SQL parse error for model {model}: {message}")]
    SqlParse { model: String, message: String },
    #[error("no compiled SQL found for model: {0}")]
    NoCompiledSql(String),
    #[error("dbt CLI error: {0}")]
    Cli(#[from] DbtCliError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}
