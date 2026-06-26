use std::io;
use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum PythonError {
    #[error("no python interpreter found on this system")]
    NoInterpreter,
    #[error("interpreter not found: {0}")]
    InterpreterNotFound(PathBuf),
    #[error("creating venv failed: {0}")]
    VenvCreate(String),
    #[error("installing ipykernel failed: {0}")]
    IpykernelInstall(String),
    #[error("no running kernel for this console")]
    NoSession,
    #[error("kernel: {0}")]
    Kernel(String),
    #[error("persisting interpreters failed: {0}")]
    Persist(String),
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error(transparent)]
    SqlCell(#[from] SqlCellError),
}

/// Failure to prepare a SQL-cell binding (the DataFrame snippet sent to the
/// kernel). Distinct from kernel/runtime errors: these happen before any code
/// reaches Python.
#[derive(Debug, Error)]
pub enum SqlCellError {
    #[error("`{0}` is not a valid Python variable name")]
    InvalidIdentifier(String),
    #[error("serializing result to Arrow failed: {0}")]
    Arrow(String),
}
