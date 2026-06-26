use thiserror::Error;

#[derive(Debug, Error)]
pub enum DebugLogError {
    #[error("global tracing subscriber was already initialized")]
    AlreadyInitialized,
}
