use std::sync::LazyLock;

use regex_lite::Regex;

use super::constants::MAX_DETAIL_LEN;

// Userinfo in any `scheme://user:pass@host` URI (e.g. a connection string that
// leaked into an error message).
static URI_USERINFO: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)([a-z][a-z0-9+.\-]*://)[^/@\s]*@").unwrap());

// `password=...`, `token: ...`, `api_key=...` style secret assignments.
static SECRET_KV: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth)\s*([=:])\s*\S+",
    )
    .unwrap()
});

/// Scrubs credentials from a free-text error message before it is persisted.
/// Belt-and-braces on top of the target filter: driver error strings are not
/// expected to echo secrets, but if one ever did this strips it. Also bounds
/// the length so a single failure cannot bloat the log.
pub(super) struct Redactor;

impl Redactor {
    pub(super) fn redact(message: &str) -> String {
        let step1 = URI_USERINFO.replace_all(message, "${1}<redacted>@");
        let step2 = SECRET_KV.replace_all(&step1, "${1}${2}<redacted>");
        let out = step2.into_owned();
        if out.chars().count() > MAX_DETAIL_LEN {
            let mut truncated: String = out.chars().take(MAX_DETAIL_LEN).collect();
            truncated.push('…');
            truncated
        } else {
            out
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Redactor;

    #[test]
    fn redacts_uri_userinfo() {
        let r = Redactor::redact(
            "connection failed: postgres://admin:s3cr3t@db.example.com:5432/app refused",
        );
        assert!(!r.contains("s3cr3t"), "{r}");
        assert!(!r.contains("admin"), "{r}");
        assert!(r.contains("postgres://<redacted>@db.example.com"), "{r}");
        // non-secret context preserved
        assert!(r.contains("refused"));
    }

    #[test]
    fn redacts_secret_key_values() {
        let r = Redactor::redact("auth error: password=hunter2 host=db port=5432");
        assert!(!r.contains("hunter2"), "{r}");
        assert!(r.contains("password=<redacted>"), "{r}");
        // surrounding non-secret metadata preserved
        assert!(r.contains("host=db"));
        assert!(r.contains("port=5432"));
    }

    #[test]
    fn redacts_token_and_apikey_forms() {
        let r = Redactor::redact("denied token: abc.def.ghi api_key=XYZ123");
        assert!(!r.contains("abc.def.ghi"), "{r}");
        assert!(!r.contains("XYZ123"), "{r}");
        assert!(r.contains("token:<redacted>"), "{r}");
        assert!(r.contains("api_key=<redacted>"), "{r}");
    }

    #[test]
    fn keeps_safe_detail_unchanged() {
        let msg = "connection failed: error connecting to server: Connection refused (os error 61)";
        assert_eq!(Redactor::redact(msg), msg);
    }

    #[test]
    fn truncates_overlong_messages() {
        let long = "x".repeat(super::MAX_DETAIL_LEN * 2);
        let r = Redactor::redact(&long);
        // MAX_DETAIL_LEN chars + the ellipsis marker.
        assert_eq!(r.chars().count(), super::MAX_DETAIL_LEN + 1);
        assert!(r.ends_with('…'));
    }

    #[test]
    fn keeps_verbose_driver_errors_intact() {
        // A MongoDB-style topology dump is long but well under the cap, so it
        // must survive without truncation.
        let mongo = "driver: connection failed: Kind: Server selection timeout: \
            No available servers. Topology: { Type: Unknown, Servers: [ { Address: \
            localhost:27017, Type: Unknown, Error: Kind: I/O error: Connection refused \
            (os error 61), labels: {\"SystemOverloadedError\", \"RetryableError\"}, \
            source: None } ] }";
        let r = Redactor::redact(mongo);
        assert_eq!(r, mongo);
        assert!(!r.ends_with('…'));
    }
}
