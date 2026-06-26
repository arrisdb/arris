use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("not found: {0}")]
    NotFound(String),
}

#[derive(Debug, Error)]
pub enum KeychainError {
    #[error("keyring error: {0}")]
    Keyring(String),
    #[error("vault decode error: {0}")]
    Decode(String),
}

#[derive(Debug, Error)]
pub enum PathError {
    #[error("could not resolve OS data directory")]
    NotResolvable,
}

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("path: {0}")]
    Path(#[from] PathError),
    #[error("store: {0}")]
    Store(#[from] StoreError),
}
