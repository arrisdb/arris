use thiserror::Error;
use uuid::Uuid;

use crate::{DriverError, ErrorCode, IpcError};
use crate::persistence::{KeychainError, StoreError};

#[derive(Debug, Error)]
pub enum ConnectionError {
    #[error("driver: {0}")]
    Driver(#[from] DriverError),
    #[error("store: {0}")]
    Store(#[from] StoreError),
    #[error("keychain: {0}")]
    Keychain(#[from] KeychainError),
    #[error("ssh tunnel: {0}")]
    SshTunnel(#[from] SshTunnelError),
    #[error("connection {0} not found")]
    ConnectionNotFound(Uuid),
    #[error("no project open")]
    NoProjectOpen,
    #[error("{0}")]
    Other(String),
}

#[derive(Debug, Error)]
pub enum SshTunnelError {
    #[error("ssh tunnel requires an SSH host")]
    MissingHost,
    #[error("ssh tunnel requires an SSH user")]
    MissingUser,
    #[error("ssh tunnel requires a password or private key")]
    MissingCredentials,
    #[error("ssh connect failed: {0}")]
    Connect(#[source] russh::Error),
    #[error("ssh authentication error: {0}")]
    Auth(#[source] russh::Error),
    #[error("ssh authentication rejected by server")]
    AuthRejected,
    #[error("failed to load SSH private key: {0}")]
    Key(#[source] russh::keys::Error),
    #[error("failed to bind local tunnel socket: {0}")]
    Bind(#[source] std::io::Error),
}

impl From<ConnectionError> for IpcError {
    fn from(e: ConnectionError) -> Self {
        match e {
            ConnectionError::Driver(ref d) => IpcError {
                code: d.error_code(),
                message: e.to_string(),
            },
            _ => IpcError {
                code: ErrorCode::Other,
                message: e.to_string(),
            },
        }
    }
}
