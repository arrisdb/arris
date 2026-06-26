//! Builds a `mongodb://` (or `mongodb+srv://`) connection string from a
//! `ConnectionConfig`. Mirrors the Swift `MongoDriver.connectionString(...)`
//! helper so paste-URI in the connection editor + the driver agree.

use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};

use crate::ConnectionConfig;

/// Mongo connection-string user/password percent-encoding set. Mirrors the
/// driver-spec list of reserved characters that must be escaped in userinfo.
const USERINFO: &AsciiSet = &CONTROLS
    .add(b':')
    .add(b'/')
    .add(b'?')
    .add(b'#')
    .add(b'[')
    .add(b']')
    .add(b'@')
    .add(b'%')
    .add(b' ');

pub fn build_uri(cfg: &ConnectionConfig) -> String {
    let scheme = if cfg.is_srv {
        "mongodb+srv"
    } else {
        "mongodb"
    };

    let mut uri = String::new();
    uri.push_str(scheme);
    uri.push_str("://");

    if !cfg.user.is_empty() {
        uri.push_str(&utf8_percent_encode(&cfg.user, USERINFO).to_string());
        if !cfg.password.is_empty() {
            uri.push(':');
            uri.push_str(&utf8_percent_encode(&cfg.password, USERINFO).to_string());
        }
        uri.push('@');
    }

    let host = if cfg.host.is_empty() {
        "localhost"
    } else {
        cfg.host.as_str()
    };
    uri.push_str(host);

    // mongodb+srv:// must omit the port — DNS SRV record provides it.
    if !cfg.is_srv {
        let port = if cfg.port == 0 { 27017 } else { cfg.port };
        uri.push(':');
        uri.push_str(&port.to_string());
    }

    if !cfg.database.is_empty() {
        uri.push('/');
        uri.push_str(&cfg.database);
    }

    let mut opts: Vec<String> = Vec::new();
    if cfg.ssl_mode.forces_tls() {
        opts.push("tls=true".to_owned());
    }
    if !cfg.options.is_empty() {
        // `options` is appended verbatim — Swift behaves the same so the user
        // controls extra parameters (replicaSet, authSource, retryWrites …).
        opts.push(cfg.options.trim_start_matches('?').trim_start_matches('&').to_owned());
    }
    if !opts.is_empty() {
        uri.push('?');
        uri.push_str(&opts.join("&"));
    }

    uri
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::DatabaseKind;

    fn cfg() -> ConnectionConfig {
        let mut c = ConnectionConfig::new("m", DatabaseKind::Mongodb);
        c.host = "db.example.com".into();
        c.port = 27017;
        c
    }

    #[test]
    fn builds_basic_uri_without_auth() {
        let mut c = cfg();
        c.database = "app".into();
        let uri = build_uri(&c);
        assert_eq!(uri, "mongodb://db.example.com:27017/app");
    }

    #[test]
    fn defaults_to_27017_when_port_zero() {
        let mut c = cfg();
        c.port = 0;
        assert_eq!(build_uri(&c), "mongodb://db.example.com:27017");
    }

    #[test]
    fn embeds_user_and_password() {
        let mut c = cfg();
        c.user = "alice".into();
        c.password = "secret".into();
        c.database = "app".into();
        assert_eq!(
            build_uri(&c),
            "mongodb://alice:secret@db.example.com:27017/app"
        );
    }

    #[test]
    fn percent_encodes_user_password() {
        let mut c = cfg();
        c.user = "us@er".into();
        c.password = "p/wd".into();
        let uri = build_uri(&c);
        assert!(uri.contains("us%40er"), "{uri}");
        assert!(uri.contains("p%2Fwd"), "{uri}");
    }

    #[test]
    fn srv_omits_port() {
        let mut c = cfg();
        c.is_srv = true;
        c.host = "cluster.example.mongodb.net".into();
        c.database = "app".into();
        let uri = build_uri(&c);
        assert!(uri.starts_with("mongodb+srv://"));
        assert!(!uri.contains(":27017"));
        assert!(uri.ends_with("/app"));
    }

    #[test]
    fn ssl_mode_appends_tls_param() {
        let mut c = cfg();
        c.ssl_mode = crate::SslMode::Required;
        let uri = build_uri(&c);
        assert!(uri.ends_with("?tls=true"), "{uri}");
    }

    #[test]
    fn raw_options_round_trip() {
        let mut c = cfg();
        c.options = "replicaSet=rs0&authSource=admin".into();
        let uri = build_uri(&c);
        assert!(uri.ends_with("?replicaSet=rs0&authSource=admin"), "{uri}");
    }

    #[test]
    fn raw_options_combine_with_tls() {
        let mut c = cfg();
        c.ssl_mode = crate::SslMode::Required;
        c.options = "authSource=admin".into();
        let uri = build_uri(&c);
        assert!(uri.ends_with("?tls=true&authSource=admin"), "{uri}");
    }

    #[test]
    fn raw_options_strip_leading_qmark_or_amp() {
        let mut c = cfg();
        c.options = "?replicaSet=rs0".into();
        let uri = build_uri(&c);
        assert!(uri.ends_with("?replicaSet=rs0"));
    }

    #[test]
    fn empty_host_defaults_to_localhost() {
        let mut c = cfg();
        c.host = String::new();
        let uri = build_uri(&c);
        assert!(uri.starts_with("mongodb://localhost:"), "{uri}");
    }
}
