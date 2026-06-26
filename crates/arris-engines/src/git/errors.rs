use thiserror::Error;

#[derive(Debug, Error)]
pub enum GitError {
    #[error("not a git repository: {0}")]
    NotARepo(String),
    #[error("gix error: {0}")]
    Gix(String),
}
