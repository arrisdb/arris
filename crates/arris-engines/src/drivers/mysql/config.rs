use std::fmt::Write as _;
use std::path::PathBuf;

use mysql_async::{ClientIdentity, Opts, OptsBuilder, SslOpts};
use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};

use crate::{ConnectionConfig, SslMode};

const USERINFO_ENCODE: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b':')
    .add(b'@')
    .add(b'/')
    .add(b'?')
    .add(b'#')
    .add(b'%');

pub(super) fn build_mysql_url(config: &ConnectionConfig) -> String {
    let mut url = String::from("mysql://");
    if !config.user.is_empty() {
        let _ = write!(url, "{}", utf8_percent_encode(&config.user, USERINFO_ENCODE));
        if !config.password.is_empty() {
            url.push(':');
            let _ = write!(
                url,
                "{}",
                utf8_percent_encode(&config.password, USERINFO_ENCODE)
            );
        }
        url.push('@');
    }
    let host = if config.host.is_empty() {
        "localhost"
    } else {
        config.host.as_str()
    };
    url.push_str(host);
    let port = if config.port == 0 { 3306 } else { config.port };
    let _ = write!(url, ":{port}");
    if !config.database.is_empty() {
        url.push('/');
        url.push_str(&config.database);
    }
    if !config.options.is_empty() {
        let opts = config
            .options
            .trim_start_matches('?')
            .trim_start_matches('&');
        url.push('?');
        url.push_str(opts);
    }
    url
}

pub(super) fn build_opts(config: &ConnectionConfig) -> Opts {
    let url = build_mysql_url(config);
    let mut b = match Opts::from_url(&url) {
        Ok(opts) => OptsBuilder::from_opts(opts),
        Err(_) => {
            let mut b = OptsBuilder::default();
            let host = if config.host.is_empty() {
                "localhost"
            } else {
                config.host.as_str()
            };
            b = b.ip_or_hostname(host);
            let port = if config.port == 0 { 3306 } else { config.port };
            b = b.tcp_port(port);
            if !config.user.is_empty() {
                b = b.user(Some(config.user.clone()));
            }
            if !config.password.is_empty() {
                b = b.pass(Some(config.password.clone()));
            }
            if !config.database.is_empty() {
                b = b.db_name(Some(config.database.clone()));
            }
            b
        }
    };
    // MySQL/MariaDB select TLS via a binary SslOpts switch (no opportunistic
    // fallback), so only the explicit modes turn it on; Preferred stays
    // plaintext. mysql_async drives rustls, whose process-wide crypto provider
    // must be installed before the handshake (ring, matching its feature).
    let needs_tls = config.ssl_mode.forces_tls();
    if needs_tls {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let strict = matches!(
            config.ssl_mode,
            SslMode::VerifyCa | SslMode::VerifyIdentity
        );
        let mut ssl = SslOpts::default();
        if !strict {
            ssl = ssl.with_danger_accept_invalid_certs(true);
        }
        if matches!(config.ssl_mode, SslMode::VerifyCa) {
            ssl = ssl.with_danger_skip_domain_validation(true);
        }
        // Load the CA so the verify modes can check the server chain against it.
        if let Some(ca) = config.ca_cert_path.as_deref().filter(|s| !s.is_empty()) {
            ssl = ssl.with_root_certs(vec![PathBuf::from(ca).into()]);
        }
        // Present a client identity (mTLS) when both cert and key are supplied.
        if let (Some(cert), Some(key)) = (
            config.client_cert_path.as_deref().filter(|s| !s.is_empty()),
            config.client_key_path.as_deref().filter(|s| !s.is_empty()),
        ) {
            ssl = ssl.with_client_identity(Some(ClientIdentity::new(
                PathBuf::from(cert).into(),
                PathBuf::from(key).into(),
            )));
        }
        b = b.ssl_opts(Some(ssl));
    }
    b.into()
}
