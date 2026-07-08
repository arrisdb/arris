use thiserror::Error;

#[derive(Debug, Error)]
pub enum CanvasError {
    #[error("cell cache I/O error: {0}")]
    Io(String),
    #[error("arrow error: {0}")]
    Arrow(String),
    #[error("result conversion error: {0}")]
    Conversion(String),
    #[error("query engine error: {0}")]
    Engine(String),
    #[error("query cancelled")]
    Cancelled,
}
