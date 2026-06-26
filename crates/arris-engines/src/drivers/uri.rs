use percent_encoding::percent_decode_str;

use super::errors::DriverError;

fn decode(s: &str) -> String {
    percent_decode_str(s).decode_utf8_lossy().into_owned()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PostgresUriComponents {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
    pub use_tls: bool,
}

pub fn parse_postgres_uri(raw: &str) -> Result<PostgresUriComponents, DriverError> {
    let trimmed = raw.trim();

    let rest = if let Some(r) = trimmed.strip_prefix("postgresql://") {
        r
    } else if let Some(r) = trimmed.strip_prefix("postgres://") {
        r
    } else {
        return Err(DriverError::InvalidArgument(
            "Expected scheme 'postgresql://' or 'postgres://'.".into(),
        ));
    };

    if rest.is_empty() {
        return Err(DriverError::InvalidArgument(
            "Connection string is missing host information.".into(),
        ));
    }

    let first_terminator = rest.find(|c| c == '/' || c == '?').unwrap_or(rest.len());
    let authority = &rest[..first_terminator];
    let tail = &rest[first_terminator..];

    let mut user = String::new();
    let mut password = String::new();
    let hostinfo: &str = if let Some(at_idx) = authority.rfind('@') {
        let userinfo = &authority[..at_idx];
        let host = &authority[at_idx + '@'.len_utf8()..];
        if let Some(colon_idx) = userinfo.find(':') {
            user = decode(&userinfo[..colon_idx]);
            password = decode(&userinfo[colon_idx + 1..]);
        } else {
            user = decode(userinfo);
        }
        host
    } else {
        authority
    };

    let (host, port): (String, u16) = if let Some(colon_idx) = hostinfo.rfind(':') {
        let port_str = &hostinfo[colon_idx + 1..];
        let parsed: u32 = port_str
            .parse()
            .map_err(|_| DriverError::InvalidArgument(format!("Invalid port '{port_str}'.")))?;
        if !(1..=65_535).contains(&parsed) {
            return Err(DriverError::InvalidArgument(format!(
                "Invalid port '{port_str}'."
            )));
        }
        (hostinfo[..colon_idx].to_owned(), parsed as u16)
    } else {
        (hostinfo.to_owned(), 0)
    };
    if host.is_empty() {
        return Err(DriverError::InvalidArgument(
            "Connection string is missing a host.".into(),
        ));
    }

    let mut database = String::new();
    let mut raw_options = "";
    if !tail.is_empty() {
        let path_start = tail.find('/');
        let query_start = tail.find('?');
        if let Some(p_idx) = path_start
            && query_start.map(|q| p_idx < q).unwrap_or(true)
        {
            let after_slash = p_idx + 1;
            let db_end = query_start.unwrap_or(tail.len());
            database = decode(&tail[after_slash..db_end]);
        }
        if let Some(q_idx) = query_start {
            raw_options = &tail[q_idx + 1..];
        }
    }

    let mut use_tls = false;
    for pair in raw_options.split('&') {
        if pair.is_empty() {
            continue;
        }
        if let Some(eq) = pair.find('=') {
            let key = pair[..eq].to_ascii_lowercase();
            let val = pair[eq + 1..].to_ascii_lowercase();
            if key == "sslmode" {
                use_tls = matches!(
                    val.as_str(),
                    "require" | "verify-ca" | "verify-full" | "prefer"
                );
            }
        }
    }

    Ok(PostgresUriComponents {
        host,
        port,
        database,
        user,
        password,
        use_tls,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_postgres_uri() {
        let c = parse_postgres_uri("postgres://alice:s3cret@db.example.com:5432/app?sslmode=require")
            .unwrap();
        assert_eq!(c.host, "db.example.com");
        assert_eq!(c.port, 5432);
        assert_eq!(c.user, "alice");
        assert_eq!(c.password, "s3cret");
        assert_eq!(c.database, "app");
        assert!(c.use_tls);
    }

    #[test]
    fn accepts_long_scheme() {
        let c = parse_postgres_uri("postgresql://h/db").unwrap();
        assert_eq!(c.host, "h");
        assert_eq!(c.port, 0);
        assert_eq!(c.database, "db");
    }

    #[test]
    fn user_only_no_password() {
        let c = parse_postgres_uri("postgres://alice@h/db").unwrap();
        assert_eq!(c.user, "alice");
        assert_eq!(c.password, "");
    }

    #[test]
    fn host_only_no_database() {
        let c = parse_postgres_uri("postgres://h").unwrap();
        assert_eq!(c.host, "h");
        assert_eq!(c.database, "");
    }

    #[test]
    fn percent_decodes_user_password_database() {
        let c = parse_postgres_uri("postgres://us%40er:p%2Fwd@h/db%20one").unwrap();
        assert_eq!(c.user, "us@er");
        assert_eq!(c.password, "p/wd");
        assert_eq!(c.database, "db one");
    }

    #[test]
    fn ssl_disable_does_not_set_tls() {
        let c = parse_postgres_uri("postgres://h/db?sslmode=disable").unwrap();
        assert!(!c.use_tls);
    }

    #[test]
    fn ssl_prefer_sets_tls() {
        let c = parse_postgres_uri("postgres://h/db?sslmode=prefer").unwrap();
        assert!(c.use_tls);
    }

    #[test]
    fn ssl_verify_full_sets_tls() {
        let c = parse_postgres_uri("postgres://h/db?sslmode=verify-full").unwrap();
        assert!(c.use_tls);
    }

    #[test]
    fn rejects_unknown_scheme() {
        let err = parse_postgres_uri("mysql://h/db").unwrap_err();
        assert!(matches!(err, DriverError::InvalidArgument(_)));
    }

    #[test]
    fn rejects_empty_after_scheme() {
        let err = parse_postgres_uri("postgres://").unwrap_err();
        assert!(matches!(err, DriverError::InvalidArgument(_)));
    }

    #[test]
    fn rejects_invalid_port() {
        let err = parse_postgres_uri("postgres://h:notanum/db").unwrap_err();
        assert!(matches!(err, DriverError::InvalidArgument(_)));
    }

    #[test]
    fn rejects_port_zero() {
        let err = parse_postgres_uri("postgres://h:0/db").unwrap_err();
        assert!(matches!(err, DriverError::InvalidArgument(_)));
    }

    #[test]
    fn rejects_port_over_65535() {
        let err = parse_postgres_uri("postgres://h:70000/db").unwrap_err();
        assert!(matches!(err, DriverError::InvalidArgument(_)));
    }

    #[test]
    fn rejects_missing_host_after_at() {
        let err = parse_postgres_uri("postgres://user@/db").unwrap_err();
        assert!(matches!(err, DriverError::InvalidArgument(_)));
    }

    #[test]
    fn ignores_unknown_query_params() {
        let c = parse_postgres_uri("postgres://h/db?application_name=app&sslmode=require").unwrap();
        assert!(c.use_tls);
        assert_eq!(c.database, "db");
    }

    #[test]
    fn last_at_wins_when_password_contains_at() {
        let c = parse_postgres_uri("postgres://alice:p%40ss@h/db").unwrap();
        assert_eq!(c.user, "alice");
        assert_eq!(c.password, "p@ss");
        assert_eq!(c.host, "h");
    }

    #[test]
    fn trims_whitespace() {
        let c = parse_postgres_uri("   postgres://h/db   ").unwrap();
        assert_eq!(c.host, "h");
    }
}
