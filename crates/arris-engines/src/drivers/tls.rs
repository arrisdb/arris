//! Shared TLS foundation for SQL drivers.
//!
//! [`SslMode`] is the single source of truth for whether a connection uses TLS
//! and how strictly the server certificate is checked:
//!
//! - `Disabled` — no TLS.
//! - `Preferred` / `Required` — encrypt, but accept any (incl. self-signed)
//!   server cert (no chain or hostname verification).
//! - `VerifyCa` — verify the certificate chain against the supplied CA, but
//!   ignore a hostname mismatch.
//! - `VerifyIdentity` — verify chain *and* hostname.
//!
//! When both a client certificate and key are supplied the resulting config
//! presents a client identity (mTLS).
//!
//! Postgres is the only consumer in this slice; the rustls-facing methods are
//! gated on the `postgres` feature. Later slices broaden this to mysql/mssql.

use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::WebPkiServerVerifier;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};

use crate::connection::types::{ConnectionConfig, SslMode};
use crate::drivers::errors::{DriverError, Result};

/// TLS policy + certificate material derived from a [`ConnectionConfig`].
pub(crate) struct TlsParams<'a> {
    ssl_mode: SslMode,
    ca_cert_path: Option<&'a str>,
    client_cert_path: Option<&'a str>,
    client_key_path: Option<&'a str>,
}

impl<'a> TlsParams<'a> {
    /// Build the TLS policy from a connection config.
    pub(crate) fn from_config(config: &'a ConnectionConfig) -> Self {
        Self {
            ssl_mode: config.ssl_mode,
            ca_cert_path: config.ca_cert_path.as_deref(),
            client_cert_path: config.client_cert_path.as_deref(),
            client_key_path: config.client_key_path.as_deref(),
        }
    }

    /// Whether TLS should be negotiated at all. Everything except `Disabled`
    /// turns it on.
    pub(crate) fn is_enabled(&self) -> bool {
        !matches!(self.ssl_mode, SslMode::Disabled)
    }

    /// Read a PEM file into DER certificates.
    fn load_certs(path: &str) -> Result<Vec<CertificateDer<'static>>> {
        let pem = std::fs::read(path)
            .map_err(|e| DriverError::InvalidArgument(format!("read cert {path}: {e}")))?;
        let mut reader = std::io::BufReader::new(&pem[..]);
        let certs = rustls_pemfile::certs(&mut reader)
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| DriverError::InvalidArgument(format!("parse cert {path}: {e}")))?;
        if certs.is_empty() {
            return Err(DriverError::InvalidArgument(format!(
                "no certificates found in {path}"
            )));
        }
        Ok(certs)
    }

    /// Read a PEM file into a single private key.
    fn load_key(path: &str) -> Result<PrivateKeyDer<'static>> {
        let pem = std::fs::read(path)
            .map_err(|e| DriverError::InvalidArgument(format!("read key {path}: {e}")))?;
        let mut reader = std::io::BufReader::new(&pem[..]);
        rustls_pemfile::private_key(&mut reader)
            .map_err(|e| DriverError::InvalidArgument(format!("parse key {path}: {e}")))?
            .ok_or_else(|| DriverError::InvalidArgument(format!("no private key found in {path}")))
    }

    /// Build a [`RootCertStore`] from the supplied CA PEM. The verify modes
    /// require a CA: without one there is no trust anchor to check the chain
    /// against, so this errors with a clear message.
    fn build_roots(&self) -> Result<RootCertStore> {
        let ca_path = self.ca_cert_path.ok_or_else(|| {
            DriverError::InvalidArgument(
                "ssl_mode verify_ca/verify_identity requires a CA certificate path".to_owned(),
            )
        })?;
        let mut roots = RootCertStore::empty();
        for cert in Self::load_certs(ca_path)? {
            roots.add(cert).map_err(|e| {
                DriverError::InvalidArgument(format!("add CA cert to trust store: {e}"))
            })?;
        }
        Ok(roots)
    }

    /// Ensure a process-wide rustls [`CryptoProvider`] (ring) is installed.
    /// Idempotent: never panics if one is already installed.
    fn ensure_crypto_provider() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    /// Build the server-certificate verifier appropriate for the mode.
    fn server_verifier(&self) -> Result<Arc<dyn ServerCertVerifier>> {
        match self.ssl_mode {
            SslMode::Disabled => Err(DriverError::InvalidArgument(
                "no TLS verifier for disabled mode".to_owned(),
            )),
            SslMode::Preferred | SslMode::Required => Ok(Arc::new(AcceptAnyServerCert)),
            SslMode::VerifyCa => {
                let roots = self.build_roots()?;
                let inner = WebPkiServerVerifier::builder(Arc::new(roots))
                    .build()
                    .map_err(|e| {
                        DriverError::InvalidArgument(format!("build CA verifier: {e}"))
                    })?;
                Ok(Arc::new(IgnoreHostnameVerifier(inner)))
            }
            SslMode::VerifyIdentity => {
                let roots = self.build_roots()?;
                let inner = WebPkiServerVerifier::builder(Arc::new(roots))
                    .build()
                    .map_err(|e| {
                        DriverError::InvalidArgument(format!("build identity verifier: {e}"))
                    })?;
                Ok(inner)
            }
        }
    }

    /// Build a rustls [`ClientConfig`] for this mode, or `Ok(None)` when TLS is
    /// disabled. Applies mTLS client identity when both cert and key paths are
    /// set.
    pub(crate) fn rustls_client_config(&self) -> Result<Option<ClientConfig>> {
        if !self.is_enabled() {
            return Ok(None);
        }
        Self::ensure_crypto_provider();

        let verifier = self.server_verifier()?;
        let builder = ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(verifier);

        let config = match (self.client_cert_path, self.client_key_path) {
            (Some(cert_path), Some(key_path)) => {
                let chain = Self::load_certs(cert_path)?;
                let key = Self::load_key(key_path)?;
                builder.with_client_auth_cert(chain, key).map_err(|e| {
                    DriverError::InvalidArgument(format!("load client identity: {e}"))
                })?
            }
            _ => builder.with_no_client_auth(),
        };
        Ok(Some(config))
    }
}

/// Accepts any server certificate (encrypt-only). Used for `Preferred` /
/// `Required`, which establish an encrypted channel but do not verify the
/// server's identity. Signature checks delegate to the ring provider so the
/// handshake's cryptographic integrity is still enforced.
#[derive(Debug)]
struct AcceptAnyServerCert;

impl ServerCertVerifier for AcceptAnyServerCert {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> std::result::Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &rustls::crypto::ring::default_provider().signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &rustls::crypto::ring::default_provider().signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// Wraps the WebPKI verifier so a hostname mismatch is tolerated while the
/// certificate chain is still verified against the CA roots. Used by
/// `VerifyCa`: WebPKI couples chain and name checks, so we run the full check
/// and downgrade only the `NotValidForName` error to success.
#[derive(Debug)]
struct IgnoreHostnameVerifier(Arc<WebPkiServerVerifier>);

impl ServerCertVerifier for IgnoreHostnameVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> std::result::Result<ServerCertVerified, rustls::Error> {
        match self
            .0
            .verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now)
        {
            Ok(v) => Ok(v),
            Err(rustls::Error::InvalidCertificate(
                rustls::CertificateError::NotValidForName
                | rustls::CertificateError::NotValidForNameContext { .. },
            )) => Ok(ServerCertVerified::assertion()),
            Err(e) => Err(e),
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        self.0.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        self.0.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.supported_verify_schemes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connection::types::DatabaseKind;
    use std::io::Write;

    /// Generate a throwaway self-signed CA PEM and return its path + tempdir.
    fn write_ca_pem() -> (tempfile::TempDir, String) {
        let cert = rcgen::generate_simple_self_signed(vec!["localhost".to_owned()])
            .expect("generate cert");
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("ca.pem");
        let mut f = std::fs::File::create(&path).expect("create pem");
        f.write_all(cert.cert.pem().as_bytes()).expect("write pem");
        let p = path.to_string_lossy().into_owned();
        (dir, p)
    }

    fn cfg(mode: SslMode) -> ConnectionConfig {
        let mut c = ConnectionConfig::new("tls", DatabaseKind::Postgres);
        c.ssl_mode = mode;
        c
    }

    #[test]
    fn disabled_mode_is_not_enabled_and_yields_no_config() {
        let c = cfg(SslMode::Disabled);
        let p = TlsParams::from_config(&c);
        assert!(!p.is_enabled());
        assert!(p.rustls_client_config().unwrap().is_none());
    }

    #[test]
    fn non_disabled_modes_are_enabled() {
        for mode in [
            SslMode::Preferred,
            SslMode::Required,
            SslMode::VerifyCa,
            SslMode::VerifyIdentity,
        ] {
            assert!(TlsParams::from_config(&cfg(mode)).is_enabled(), "{mode:?}");
        }
    }

    #[test]
    fn accept_any_modes_build_config_without_ca() {
        for mode in [SslMode::Preferred, SslMode::Required] {
            let c = cfg(mode);
            let p = TlsParams::from_config(&c);
            assert!(
                p.rustls_client_config().unwrap().is_some(),
                "{mode:?} should yield a config"
            );
        }
    }

    #[test]
    fn verify_modes_require_ca_path() {
        for mode in [SslMode::VerifyCa, SslMode::VerifyIdentity] {
            let c = cfg(mode);
            let p = TlsParams::from_config(&c);
            let err = p.rustls_client_config().unwrap_err();
            assert!(
                matches!(err, DriverError::InvalidArgument(_)),
                "{mode:?} without CA should error, got {err:?}"
            );
        }
    }

    #[test]
    fn verify_modes_build_config_with_valid_ca() {
        let (_dir, ca) = write_ca_pem();
        for mode in [SslMode::VerifyCa, SslMode::VerifyIdentity] {
            let mut c = cfg(mode);
            c.ca_cert_path = Some(ca.clone());
            let p = TlsParams::from_config(&c);
            assert!(
                p.rustls_client_config().unwrap().is_some(),
                "{mode:?} with CA should yield a config"
            );
        }
    }

    #[test]
    fn missing_ca_file_path_errors() {
        let mut c = cfg(SslMode::VerifyCa);
        c.ca_cert_path = Some("/nonexistent/path/ca.pem".to_owned());
        let p = TlsParams::from_config(&c);
        let err = p.rustls_client_config().unwrap_err();
        assert!(matches!(err, DriverError::InvalidArgument(_)), "{err:?}");
    }

    #[test]
    fn load_certs_reads_generated_pem() {
        let (_dir, ca) = write_ca_pem();
        let certs = TlsParams::load_certs(&ca).expect("load certs");
        assert_eq!(certs.len(), 1);
    }
}
