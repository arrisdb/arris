use serde_yml::{Mapping, Value};

use super::constants::{JINJA_OPEN, OPTION_ASSIGN, OPTION_SEPARATOR};
use super::{ConnectionConfig, ConnectionPrefill, DatabaseKind, PrefillField};

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
