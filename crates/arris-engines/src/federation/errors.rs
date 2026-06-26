use thiserror::Error;

#[derive(Debug, Error)]
pub enum FederationError {
    #[error("invalid federation reference: {0}")]
    InvalidReference(String),
    #[error("scan failed for {connection}: {source}")]
    ScanFailed {
        connection: String,
        #[source]
        source: crate::DriverError,
    },
    #[error("connection error: {0}")]
    Connection(String),
    #[error("engine error: {0}")]
    Engine(String),
}
