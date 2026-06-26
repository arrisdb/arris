use crate::agent::types::AgentProvider;
use crate::connection::ConnectionError;
use crate::{DriverError, ErrorCode, IpcError};

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("{0} CLI not found. Install the {0} CLI and make sure it is on PATH.")]
    CliNotFound(AgentProvider),
    #[error("no project is open")]
    NoProject,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("connection: {0}")]
    Connection(#[from] ConnectionError),
    #[error("driver: {0}")]
    Driver(#[from] DriverError),
}

impl From<AgentError> for IpcError {
    fn from(e: AgentError) -> Self {
        IpcError {
            code: ErrorCode::Other,
            message: e.to_string(),
        }
    }
}
