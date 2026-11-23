use percent_encoding::percent_decode_str;
use serde_yml::{Mapping, Value};
use url::Url;

use super::constants::{
    CONNECTION_URL_LABEL, JINJA_OPEN, MONGODB_SRV_SCHEME, OPTION_ASSIGN, OPTION_SEPARATOR,
    URL_PATH_SEPARATOR, URL_SCHEMES,
};
use super::{ConnectionConfig, ConnectionPrefill, DatabaseKind, PrefillError, PrefillField};

impl ConnectionPrefill {
    /// Copies only the listed keys, first alias wins; Jinja values are dropped.
    pub fn from_mapping(
        name: String,
        kind: DatabaseKind,
        source: &Mapping,
        keys: &[(&str, PrefillField)],
    ) -> Self {
        let mut fields = ConnectionConfig::new(name.clone(), kind);
        fields.port = kind.default_port();
        let mut seen: Vec<PrefillField> = Vec::new();
        let mut options: Vec<String> = Vec::new();
        for (key, field) in keys {
            if seen.contains(field) {
                continue;
            }
            let Some(value) = source.get(*key).and_then(Self::plain) else {
                continue;
            };
            match field {
                PrefillField::Host => fields.host = value,
                PrefillField::Port => match value.parse() {
                    Ok(port) => fields.port = port,
                    Err(_) => continue,
                },
                PrefillField::Database => fields.database = value,
                PrefillField::User => fields.user = value,
                PrefillField::FilePath => fields.file_path = Some(value),
                PrefillField::CredentialsFile => fields.credentials_file = Some(value),
                PrefillField::Location => fields.location = Some(value),
                PrefillField::Option(option) => {
                    options.push(format!("{option}{OPTION_ASSIGN}{value}"))
                }
            }
            seen.push(*field);
        }
        fields.options = options.join(OPTION_SEPARATOR);
        Self { name, kind, fields }.scrubbed()
    }

    /// Reads host, port, user, database and query options from a URI; a password is dropped.
    pub fn from_url(raw: &str) -> Result<Self, PrefillError> {
        let url = Url::parse(raw.trim())
            .map_err(|_| PrefillError::Invalid(CONNECTION_URL_LABEL.into()))?;
        let scheme = url.scheme();
        let kind = URL_SCHEMES
            .iter()
            .find(|(s, _)| *s == scheme)
            .map(|(_, k)| *k)
            .ok_or_else(|| PrefillError::UnsupportedAdapter(scheme.into()))?;
        let host = url.host_str().unwrap_or_default().to_owned();
        let decode = |s: &str| percent_decode_str(s).decode_utf8_lossy().into_owned();
        let mut fields = ConnectionConfig::new(host.clone(), kind);
        fields.host = host.clone();
        fields.port = url.port().unwrap_or(kind.default_port());
        fields.user = decode(url.username());
        fields.database = decode(url.path().trim_start_matches(URL_PATH_SEPARATOR));
        fields.options = url.query().unwrap_or_default().to_owned();
        fields.is_srv = scheme == MONGODB_SRV_SCHEME;
        Ok(Self {
            name: host,
            kind,
            fields,
        }
        .scrubbed())
    }

    /// Clears every secret field and keeps `fields` in step with `name` and `kind`.
    pub fn scrubbed(mut self) -> Self {
        self.fields.password.clear();
        self.fields.ssh_password = None;
        self.fields.name = self.name.clone();
        self.fields.kind = self.kind;
        self
    }

    fn plain(value: &Value) -> Option<String> {
        let text = match value {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => b.to_string(),
            _ => return None,
        };
        (!text.is_empty() && !text.contains(JINJA_OPEN)).then_some(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEYS: &[(&str, PrefillField)] = &[
        ("host", PrefillField::Host),
        ("port", PrefillField::Port),
        ("dbname", PrefillField::Database),
        ("database", PrefillField::Database),
        ("schema", PrefillField::Option("schema")),
        ("role", PrefillField::Option("role")),
    ];

    fn mapping(yaml: &str) -> Mapping {
        serde_yml::from_str(yaml).unwrap()
    }

    #[test]
    fn url_fills_host_port_and_default_port() {
        let prefill = ConnectionPrefill::from_url("mongodb://localhost").unwrap();
        assert_eq!(prefill.kind, DatabaseKind::Mongodb);
        assert_eq!(prefill.name, "localhost");
        assert_eq!(prefill.fields.host, "localhost");
        assert_eq!(prefill.fields.port, DatabaseKind::Mongodb.default_port());
        let pg = ConnectionPrefill::from_url("postgresql://db.local:6543/shop").unwrap();
        assert_eq!((pg.kind, pg.fields.port), (DatabaseKind::Postgres, 6543));
        assert_eq!(pg.fields.database, "shop");
    }

    #[test]
    fn url_keeps_user_and_options_but_drops_the_password() {
        let raw = "mongodb+srv://ada%40x:s3cret@cluster.example.net/app%20db?authSource=admin";
        let prefill = ConnectionPrefill::from_url(raw).unwrap();
        assert!(prefill.fields.is_srv);
        assert_eq!(prefill.fields.user, "ada@x");
        assert_eq!(prefill.fields.database, "app db");
        assert_eq!(prefill.fields.options, "authSource=admin");
        assert!(prefill.fields.password.is_empty());
    }

    #[test]
    fn url_rejects_unknown_schemes_and_garbage() {
        assert!(matches!(
            ConnectionPrefill::from_url("ftp://h"),
            Err(PrefillError::UnsupportedAdapter(s)) if s == "ftp"
        ));
        assert!(matches!(
            ConnectionPrefill::from_url("not a url"),
            Err(PrefillError::Invalid(_))
        ));
    }

    #[test]
    fn first_alias_wins_and_options_join() {
        let source = mapping("host: h\nport: 6543\ndbname: a\ndatabase: b\nschema: s\nrole: r\n");
        let prefill =
            ConnectionPrefill::from_mapping("n".into(), DatabaseKind::Postgres, &source, KEYS);
        assert_eq!(prefill.fields.database, "a");
        assert_eq!(prefill.fields.port, 6543);
        assert_eq!(prefill.fields.options, "schema=s&role=r");
    }

    #[test]
    fn templated_values_fall_back_to_defaults() {
        let source = mapping("host: \"{{ env_var('H') }}\"\nport: \"{{ env_var('P') | int }}\"\n");
        let prefill =
            ConnectionPrefill::from_mapping("n".into(), DatabaseKind::Postgres, &source, KEYS);
        assert!(prefill.fields.host.is_empty());
        assert_eq!(prefill.fields.port, DatabaseKind::Postgres.default_port());
    }

    #[test]
    fn scrubbed_clears_secrets() {
        let mut fields = ConnectionConfig::new("x", DatabaseKind::Mysql);
        fields.password = "pw".into();
        fields.ssh_password = Some("ssh".into());
        let prefill = ConnectionPrefill {
            name: "n".into(),
            kind: DatabaseKind::Postgres,
            fields,
        }
        .scrubbed();
        assert!(prefill.fields.password.is_empty());
        assert_eq!(prefill.fields.ssh_password, None);
        assert_eq!(prefill.fields.name, "n");
        assert_eq!(prefill.fields.kind, DatabaseKind::Postgres);
    }
}
