use tiberius::{AuthMethod, Client, Config, EncryptionLevel};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use crate::{ConnectionConfig, DriverError, SslMode};
use crate::drivers::errors::Result;

type MssqlClient = Client<Compat<TcpStream>>;

pub(super) fn build_config(config: &ConnectionConfig) -> Config {
    let mut cfg = Config::new();
    let host = if config.host.is_empty() {
        "localhost"
    } else {
        config.host.as_str()
    };
    cfg.host(host);
    cfg.port(if config.port == 0 { 1433 } else { config.port });
    if !config.user.is_empty() {
        cfg.authentication(AuthMethod::sql_server(&config.user, &config.password));
    }
    if !config.database.is_empty() {
        cfg.database(&config.database);
    }
    let (level, trust_self_signed) = encryption_plan(config.ssl_mode);
    cfg.encryption(level);
    if trust_self_signed {
        cfg.trust_cert();
    } else if let Some(ca) = config.ca_cert_path.as_deref().filter(|s| !s.is_empty()) {
        // verify_ca / verify_identity: validate the server chain against this CA.
        cfg.trust_cert_ca(ca);
    }
    // tiberius 0.12 exposes no client-certificate (mTLS) API, so
    // client_cert_path / client_key_path are not applied for MSSQL.
    cfg
}

/// Map an [`SslMode`] to a tiberius [`EncryptionLevel`] and whether to trust a
/// self-signed server cert. `ssl_mode` is the single source of truth.
///
/// `Preferred` (the default) negotiates TLS and accepts the server's
/// self-signed cert — SQL Server effectively always offers encryption, so
/// disabling it here is what caused connections to silently run unencrypted.
/// `Disabled` opts out entirely; the verifying modes require a valid cert
/// chain (no `trust_cert`).
pub(super) fn encryption_plan(ssl_mode: SslMode) -> (EncryptionLevel, bool) {
    match ssl_mode {
        SslMode::Disabled => (EncryptionLevel::NotSupported, false),
        SslMode::VerifyCa | SslMode::VerifyIdentity => (EncryptionLevel::Required, false),
        // Preferred or Required.
        _ => (EncryptionLevel::Required, true),
    }
}

pub(super) async fn connect_tcp(cfg: &Config) -> Result<MssqlClient> {
    let addr = cfg.get_addr();
    let tcp = TcpStream::connect(addr)
        .await
        .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
    tcp.set_nodelay(true)
        .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
    let client = Client::connect(cfg.clone(), tcp.compat_write())
        .await
        .map_err(|e| DriverError::ConnectionFailed(e.to_string()))?;
    Ok(client)
}
