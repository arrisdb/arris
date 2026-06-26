use std::net::SocketAddr;
use std::sync::Arc;

use russh::client::{self, Handle};
use russh::keys::{PrivateKeyWithHashAlg, load_secret_key};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

use super::errors::SshTunnelError;
use super::types::ConnectionConfig;

const DEFAULT_SSH_PORT: u16 = 22;

// ── Auth method selection ────────────────────────────────────────────────────

pub(super) enum SshAuthMethod {
    Password(String),
    PrivateKey {
        path: String,
        passphrase: Option<String>,
    },
}

impl SshAuthMethod {
    /// Pick the auth method from a config. A private key takes priority; the SSH
    /// password doubles as the key passphrase when a key is set. Returns `None`
    /// when neither a key nor a password is supplied.
    pub(super) fn from_config(cfg: &ConnectionConfig) -> Option<Self> {
        let password = cfg.ssh_password.clone().filter(|s| !s.is_empty());
        match cfg.ssh_private_key.as_deref().filter(|s| !s.is_empty()) {
            Some(path) => Some(Self::PrivateKey {
                path: path.to_string(),
                passphrase: password,
            }),
            None => password.map(Self::Password),
        }
    }
}

// ── Host-key handler ─────────────────────────────────────────────────────────

/// Accepts any bastion host key (no `known_hosts` verification) — matches the
/// default posture of DBeaver/TablePlus. There is no fingerprint UI to pin.
struct AcceptAnyHostKey;

impl client::Handler for AcceptAnyHostKey {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

// ── SshTunnel ────────────────────────────────────────────────────────────────

/// A live SSH local port-forward. Binds `127.0.0.1:<os-port>` and forwards every
/// accepted socket through the bastion to the database's `host:port` (as seen
/// from the bastion). Dropping the tunnel aborts the accept loop and closes the
/// SSH session.
pub struct SshTunnel {
    local_addr: SocketAddr,
    accept_task: JoinHandle<()>,
}

impl SshTunnel {
    pub async fn open(cfg: &ConnectionConfig) -> Result<Self, SshTunnelError> {
        let ssh_host = cfg
            .ssh_host
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or(SshTunnelError::MissingHost)?;
        let ssh_port = cfg.ssh_port.unwrap_or(DEFAULT_SSH_PORT);
        let ssh_user = cfg
            .ssh_user
            .as_deref()
            .filter(|s| !s.is_empty())
            .ok_or(SshTunnelError::MissingUser)?;
        let auth = SshAuthMethod::from_config(cfg).ok_or(SshTunnelError::MissingCredentials)?;

        let config = Arc::new(client::Config::default());
        let mut handle = client::connect(config, (ssh_host, ssh_port), AcceptAnyHostKey)
            .await
            .map_err(SshTunnelError::Connect)?;

        let result = match auth {
            SshAuthMethod::Password(password) => handle
                .authenticate_password(ssh_user, password)
                .await
                .map_err(SshTunnelError::Auth)?,
            SshAuthMethod::PrivateKey { path, passphrase } => {
                let key =
                    load_secret_key(&path, passphrase.as_deref()).map_err(SshTunnelError::Key)?;
                let hash_alg = handle
                    .best_supported_rsa_hash()
                    .await
                    .map_err(SshTunnelError::Auth)?
                    .flatten();
                handle
                    .authenticate_publickey(ssh_user, PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg))
                    .await
                    .map_err(SshTunnelError::Auth)?
            }
        };
        if !result.success() {
            return Err(SshTunnelError::AuthRejected);
        }

        let listener = TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(SshTunnelError::Bind)?;
        let local_addr = listener.local_addr().map_err(SshTunnelError::Bind)?;

        let handle = Arc::new(handle);
        let target_host = cfg.host.clone();
        let target_port = u32::from(cfg.port);

        let accept_task = tokio::spawn(async move {
            while let Ok((socket, _peer)) = listener.accept().await {
                let handle = handle.clone();
                let target_host = target_host.clone();
                tokio::spawn(async move {
                    let _ = Self::forward(handle, socket, target_host, target_port).await;
                });
            }
        });

        Ok(Self {
            local_addr,
            accept_task,
        })
    }

    async fn forward(
        handle: Arc<Handle<AcceptAnyHostKey>>,
        mut socket: TcpStream,
        host: String,
        port: u32,
    ) -> Result<(), russh::Error> {
        let channel = handle
            .channel_open_direct_tcpip(host, port, "127.0.0.1", 0)
            .await?;
        let mut stream = channel.into_stream();
        let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
        Ok(())
    }

    pub fn local_host(&self) -> String {
        self.local_addr.ip().to_string()
    }

    pub fn local_port(&self) -> u16 {
        self.local_addr.port()
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::types::DatabaseKind;

    fn base_cfg() -> ConnectionConfig {
        let mut cfg = ConnectionConfig::new("c", DatabaseKind::Postgres);
        cfg.host = "db.internal".into();
        cfg.port = 5432;
        cfg.ssh_host = Some("bastion.example.com".into());
        cfg.ssh_user = Some("ec2-user".into());
        cfg
    }

    #[test]
    fn auth_none_without_key_or_password() {
        let cfg = base_cfg();
        assert!(SshAuthMethod::from_config(&cfg).is_none());
    }

    #[test]
    fn auth_password_when_only_password_set() {
        let mut cfg = base_cfg();
        cfg.ssh_password = Some("hunter2".into());
        match SshAuthMethod::from_config(&cfg) {
            Some(SshAuthMethod::Password(p)) => assert_eq!(p, "hunter2"),
            _ => panic!("expected password auth"),
        }
    }

    #[test]
    fn auth_key_takes_priority_password_becomes_passphrase() {
        let mut cfg = base_cfg();
        cfg.ssh_password = Some("passphrase".into());
        cfg.ssh_private_key = Some("/home/me/.ssh/id_ed25519".into());
        match SshAuthMethod::from_config(&cfg) {
            Some(SshAuthMethod::PrivateKey { path, passphrase }) => {
                assert_eq!(path, "/home/me/.ssh/id_ed25519");
                assert_eq!(passphrase.as_deref(), Some("passphrase"));
            }
            _ => panic!("expected private-key auth"),
        }
    }

    #[test]
    fn auth_key_without_passphrase() {
        let mut cfg = base_cfg();
        cfg.ssh_private_key = Some("/home/me/.ssh/id_ed25519".into());
        match SshAuthMethod::from_config(&cfg) {
            Some(SshAuthMethod::PrivateKey { passphrase, .. }) => assert!(passphrase.is_none()),
            _ => panic!("expected private-key auth"),
        }
    }

    #[test]
    fn empty_strings_treated_as_unset() {
        let mut cfg = base_cfg();
        cfg.ssh_password = Some(String::new());
        cfg.ssh_private_key = Some(String::new());
        assert!(SshAuthMethod::from_config(&cfg).is_none());
    }
}
