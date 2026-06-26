use thiserror::Error;

#[derive(Debug, Error)]
pub enum FileError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}
