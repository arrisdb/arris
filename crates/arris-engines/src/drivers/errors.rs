use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DriverError {
    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    #[error("not connected")]
    NotConnected,

    #[error("connection failed: {0}")]
    ConnectionFailed(String),

    #[error("query failed: {0}")]
    QueryFailed(String),

    #[error("explain unsupported for this driver / mode")]
    ExplainUnsupported,

    #[error("primary key required for table '{0}'")]
    MissingPrimaryKey(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("query cancelled")]
    Cancelled,

    #[error("transactions are not supported by this driver")]
    TransactionUnsupported,

    #[error("operation unsupported: {0}")]
    Unsupported(String),

    #[error("{0}")]
    Other(String),
}

impl DriverError {
    pub fn other(msg: impl Into<String>) -> Self {
        Self::Other(msg.into())
    }

    pub fn error_code(&self) -> ErrorCode {
        match self {
            Self::InvalidArgument(_) => ErrorCode::InvalidArgument,
            Self::NotConnected => ErrorCode::NotConnected,
            Self::ConnectionFailed(_) => ErrorCode::ConnectionFailed,
            Self::QueryFailed(_) => ErrorCode::QueryFailed,
            Self::ExplainUnsupported => ErrorCode::ExplainUnsupported,
            Self::MissingPrimaryKey(_) => ErrorCode::MissingPrimaryKey,
            Self::Io(_) => ErrorCode::Io,
            Self::Serde(_) => ErrorCode::Serialization,
            Self::Cancelled => ErrorCode::Cancelled,
            Self::TransactionUnsupported => ErrorCode::TransactionUnsupported,
            Self::Unsupported(_) => ErrorCode::Unsupported,
            Self::Other(_) => ErrorCode::Other,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    InvalidArgument,
    NotConnected,
    ConnectionFailed,
    QueryFailed,
    ExplainUnsupported,
    MissingPrimaryKey,
    Io,
    Serialization,
    Cancelled,
    TransactionUnsupported,
    Unsupported,
    Other,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IpcError {
    pub code: ErrorCode,
    pub message: String,
}

impl From<&DriverError> for IpcError {
    fn from(e: &DriverError) -> Self {
        Self {
            code: e.error_code(),
            message: e.to_string(),
        }
    }
}

impl From<DriverError> for IpcError {
    fn from(e: DriverError) -> Self {
        Self {
            code: e.error_code(),
            message: e.to_string(),
        }
    }
}

pub type Result<T> = std::result::Result<T, DriverError>;
