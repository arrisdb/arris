use crate::connection::ConnectionError;
use crate::{DriverError, ErrorCode, IpcError};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum QueryError {
    #[error("driver: {0}")]
    Driver(#[from] DriverError),
    #[error("connection: {0}")]
    Connection(#[from] ConnectionError),
    #[error("{0}")]
    Other(String),
}

impl From<QueryError> for IpcError {
    fn from(e: QueryError) -> Self {
        match e {
            QueryError::Driver(ref d) => IpcError {
                code: d.error_code(),
                message: e.to_string(),
            },
            QueryError::Connection(c) => IpcError::from(c),
            _ => IpcError {
                code: ErrorCode::Other,
                message: e.to_string(),
            },
        }
    }
}
