use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── DatabaseKind ────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseKind {
    Postgres,
    Mongodb,
    Mysql,
    Mariadb,
    Sqlite,
    Redis,
    Kafka,
    Bigquery,
    Redshift,
    Snowflake,
    Mssql,
    Oracle,
    Mixpanel,
    Duckdb,
    Clickhouse,
    Elasticsearch,
    Trino,
    Dynamodb,
    Starrocks,
}

impl DatabaseKind {
    pub const ALL: [Self; 19] = [
        Self::Postgres, Self::Mongodb, Self::Mysql, Self::Mariadb, Self::Sqlite,
        Self::Redis, Self::Kafka, Self::Bigquery, Self::Redshift,
        Self::Snowflake, Self::Mssql, Self::Oracle, Self::Mixpanel, Self::Duckdb,
        Self::Clickhouse, Self::Elasticsearch, Self::Trino, Self::Dynamodb,
        Self::Starrocks,
    ];

    pub fn default_port(self) -> u16 {
        match self {
            Self::Postgres => 5432,
            Self::Mongodb => 27017,
            Self::Mysql | Self::Mariadb => 3306,
            Self::Sqlite => 0,
            Self::Redis => 6379,
            Self::Kafka => 9092,
            Self::Bigquery => 0,
            Self::Redshift => 5439,
            Self::Snowflake => 443,
            Self::Mssql => 1433,
            Self::Oracle => 1521,
            Self::Mixpanel => 0,
            Self::Duckdb => 0,
            Self::Clickhouse => 8123,
            Self::Elasticsearch => 9200,
            Self::Trino => 8080,
            Self::Dynamodb => 0,
            // StarRocks FE MySQL-protocol query port.
            Self::Starrocks => 9030,
        }
    }

    pub fn is_file_based(self) -> bool {
        matches!(self, Self::Sqlite | Self::Duckdb)
    }

    pub fn supports_sql_subquery(self) -> bool {
        !matches!(
            self,
            Self::Kafka
                | Self::Mixpanel
                | Self::Mongodb
                | Self::Redis
                | Self::Elasticsearch
                | Self::Dynamodb
        )
    }
}

// ── SslMode ─────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, Debug, Default, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SslMode {
    Disabled,
    #[default]
    Preferred,
    Required,
    #[serde(rename = "verify_ca")]
    VerifyCa,
    #[serde(rename = "verify_identity")]
    VerifyIdentity,
}

impl SslMode {
    /// Whether a scheme-only driver should negotiate TLS. MongoDB, Redis,
    /// ClickHouse, Elasticsearch and Kafka select TLS by a binary URL scheme
    /// (`rediss`, `https`, …) and cannot negotiate opportunistically, so only
    /// the explicit modes (`Required` and stricter) turn it on; `Preferred`
    /// and `Disabled` stay plaintext. Negotiating drivers (Postgres, MySQL,
    /// MSSQL) instead treat `Preferred` as opportunistic TLS via
    /// [`crate::drivers::tls::TlsParams`].
    pub fn forces_tls(self) -> bool {
        matches!(self, SslMode::Required | SslMode::VerifyCa | SslMode::VerifyIdentity)
    }
}

// ── SaslMechanism ───────────────────────────────────────────────────────────

#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub enum SaslMechanism {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "PLAIN")]
    Plain,
    #[serde(rename = "SCRAM-SHA-256")]
    ScramSha256,
    #[serde(rename = "SCRAM-SHA-512")]
    ScramSha512,
}

// ── ConnectionConfig ────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    #[serde(default = "Uuid::new_v4")]
    pub id: Uuid,
    pub name: String,
    pub kind: DatabaseKind,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub database: String,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub password: String,
    #[serde(default, rename = "isSRV")]
    pub is_srv: bool,
    #[serde(default)]
    pub options: String,
    #[serde(default)]
    pub ssl_mode: SslMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ca_cert_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_cert_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_key_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "schemaRegistryURL")]
    pub schema_registry_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sasl_mechanism: Option<SaslMechanism>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credentials_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_port: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_private_key: Option<String>,
}

impl ConnectionConfig {
    pub fn new(name: impl Into<String>, kind: DatabaseKind) -> Self {
        Self {
            id: Uuid::new_v4(),
            name: name.into(),
            kind,
            host: String::new(),
            port: 0,
            database: String::new(),
            user: String::new(),
            password: String::new(),
            is_srv: false,
            options: String::new(),
            ssl_mode: SslMode::default(),
            ca_cert_path: None,
            client_cert_path: None,
            client_key_path: None,
            file_path: None,
            schema_registry_url: None,
            sasl_mechanism: None,
            credentials_file: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_password: None,
            ssh_private_key: None,
        }
    }

    pub fn is_file_based(&self) -> bool {
        self.kind.is_file_based()
    }

    pub fn default_port(&self) -> u16 {
        self.kind.default_port()
    }

    /// Whether this connection should be routed through an SSH tunnel: an SSH
    /// host is set and the kind is a network database (file-based kinds never
    /// tunnel).
    pub fn uses_ssh_tunnel(&self) -> bool {
        !self.is_file_based() && self.ssh_host.as_deref().is_some_and(|h| !h.is_empty())
    }
}

// ── ActiveConnection ─────────────────────────────────────────────────────────

/// A live driver plus the SSH tunnel (if any) that backs it. The tunnel is kept
/// alive for the connection's lifetime and torn down when this value is dropped.
pub(super) struct ActiveConnection {
    pub(super) driver: std::sync::Arc<dyn crate::drivers::DatabaseDriver>,
    pub(super) _tunnel: Option<super::impl_ssh_tunnel::SshTunnel>,
}

// ── TransactionConfig ────────────────────────────────────────────────────────

/// Per-connection transaction settings chosen in the UI: commit mode and the
/// isolation level applied when a manual transaction opens. Defaults to
/// auto-commit at the server's default isolation.
#[derive(Copy, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionConfig {
    pub mode: crate::TransactionMode,
    pub isolation: crate::IsolationLevel,
}

// ── ScopedConnection ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedConnection {
    #[serde(flatten)]
    pub config: ConnectionConfig,
    pub scope: String,
    pub is_connected: bool,
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn database_kind_serde_uses_lowercase_string() {
        assert_eq!(serde_json::to_string(&DatabaseKind::Postgres).unwrap(), "\"postgres\"");
        assert_eq!(serde_json::to_string(&DatabaseKind::Elasticsearch).unwrap(), "\"elasticsearch\"");
        let parsed: DatabaseKind = serde_json::from_str("\"mongodb\"").unwrap();
        assert_eq!(parsed, DatabaseKind::Mongodb);
    }

    #[test]
    fn default_ports_match_swift() {
        assert_eq!(DatabaseKind::Postgres.default_port(), 5432);
        assert_eq!(DatabaseKind::Mysql.default_port(), 3306);
        assert_eq!(DatabaseKind::Mariadb.default_port(), 3306);
        assert_eq!(DatabaseKind::Mongodb.default_port(), 27017);
        assert_eq!(DatabaseKind::Redis.default_port(), 6379);
        assert_eq!(DatabaseKind::Kafka.default_port(), 9092);
        assert_eq!(DatabaseKind::Redshift.default_port(), 5439);
        assert_eq!(DatabaseKind::Snowflake.default_port(), 443);
        assert_eq!(DatabaseKind::Mssql.default_port(), 1433);
        assert_eq!(DatabaseKind::Oracle.default_port(), 1521);
        assert_eq!(DatabaseKind::Clickhouse.default_port(), 8123);
        assert_eq!(DatabaseKind::Elasticsearch.default_port(), 9200);
        assert_eq!(DatabaseKind::Sqlite.default_port(), 0);
        assert_eq!(DatabaseKind::Duckdb.default_port(), 0);
        assert_eq!(DatabaseKind::Bigquery.default_port(), 0);
        assert_eq!(DatabaseKind::Mixpanel.default_port(), 0);
        assert_eq!(DatabaseKind::Trino.default_port(), 8080);
        assert_eq!(DatabaseKind::Dynamodb.default_port(), 0);
        assert_eq!(DatabaseKind::Starrocks.default_port(), 9030);
    }

    #[test]
    fn file_based_set() {
        assert!(DatabaseKind::Sqlite.is_file_based());
        assert!(DatabaseKind::Duckdb.is_file_based());
        assert!(!DatabaseKind::Postgres.is_file_based());
    }

    #[test]
    fn all_array_covers_every_variant() {
        assert_eq!(DatabaseKind::ALL.len(), 19);
    }

    #[test]
    fn supports_sql_subquery() {
        assert!(DatabaseKind::Postgres.supports_sql_subquery());
        assert!(DatabaseKind::Mysql.supports_sql_subquery());
        assert!(DatabaseKind::Starrocks.supports_sql_subquery());
        assert!(DatabaseKind::Sqlite.supports_sql_subquery());
        assert!(!DatabaseKind::Kafka.supports_sql_subquery());
        assert!(!DatabaseKind::Mixpanel.supports_sql_subquery());
        assert!(!DatabaseKind::Mongodb.supports_sql_subquery());
        assert!(!DatabaseKind::Redis.supports_sql_subquery());
        assert!(!DatabaseKind::Elasticsearch.supports_sql_subquery());
        assert!(!DatabaseKind::Dynamodb.supports_sql_subquery());
    }

    #[test]
    fn ssl_mode_round_trip() {
        for variant in [SslMode::Disabled, SslMode::Preferred, SslMode::Required, SslMode::VerifyCa, SslMode::VerifyIdentity] {
            let s = serde_json::to_string(&variant).unwrap();
            let back: SslMode = serde_json::from_str(&s).unwrap();
            assert_eq!(variant, back);
        }
    }

    #[test]
    fn ssl_mode_snake_case_for_verify_variants() {
        assert_eq!(serde_json::to_string(&SslMode::VerifyCa).unwrap(), "\"verify_ca\"");
        assert_eq!(serde_json::to_string(&SslMode::VerifyIdentity).unwrap(), "\"verify_identity\"");
    }

    #[test]
    fn ssl_mode_default_is_preferred() {
        assert_eq!(SslMode::default(), SslMode::Preferred);
    }

    #[test]
    fn sasl_raw_values_match_swift_form() {
        assert_eq!(serde_json::to_string(&SaslMechanism::None).unwrap(), "\"none\"");
        assert_eq!(serde_json::to_string(&SaslMechanism::Plain).unwrap(), "\"PLAIN\"");
        assert_eq!(serde_json::to_string(&SaslMechanism::ScramSha256).unwrap(), "\"SCRAM-SHA-256\"");
        assert_eq!(serde_json::to_string(&SaslMechanism::ScramSha512).unwrap(), "\"SCRAM-SHA-512\"");
    }

    #[test]
    fn sasl_round_trip() {
        for variant in [SaslMechanism::None, SaslMechanism::Plain, SaslMechanism::ScramSha256, SaslMechanism::ScramSha512] {
            let s = serde_json::to_string(&variant).unwrap();
            let back: SaslMechanism = serde_json::from_str(&s).unwrap();
            assert_eq!(variant, back);
        }
    }

    #[test]
    fn connection_config_round_trip_minimum_payload() {
        let cfg = ConnectionConfig::new("local pg", DatabaseKind::Postgres);
        let s = serde_json::to_string(&cfg).unwrap();
        let back: ConnectionConfig = serde_json::from_str(&s).unwrap();
        assert_eq!(cfg, back);
    }

    #[test]
    fn connection_config_loads_swift_emitted_json() {
        let json = r#"{
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "prod",
            "kind": "postgres",
            "host": "db.example.com",
            "port": 5432,
            "database": "app",
            "user": "rw",
            "password": "secret",
            "useTLS": true,
            "isSRV": false,
            "options": "sslmode=require",
            "sslMode": "required",
            "filePath": null,
            "schemaRegistryURL": null,
            "saslMechanism": null
        }"#;
        let cfg: ConnectionConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.id, Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap());
        assert_eq!(cfg.kind, DatabaseKind::Postgres);
        assert_eq!(cfg.host, "db.example.com");
        assert_eq!(cfg.port, 5432);
        assert!(!cfg.is_srv);
        assert_eq!(cfg.ssl_mode, SslMode::Required);
        assert_eq!(cfg.file_path, None);
    }

    #[test]
    fn connection_config_loads_missing_optional_fields() {
        let json = r#"{"id": "00000000-0000-0000-0000-000000000002", "name": "lite", "kind": "sqlite"}"#;
        let cfg: ConnectionConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.kind, DatabaseKind::Sqlite);
        assert_eq!(cfg.password, "");
        assert_eq!(cfg.ssl_mode, SslMode::Preferred);
    }

    #[test]
    fn kafka_with_sasl_round_trips() {
        let mut cfg = ConnectionConfig::new("events", DatabaseKind::Kafka);
        cfg.host = "broker:9092".into();
        cfg.port = 9092;
        cfg.sasl_mechanism = Some(SaslMechanism::ScramSha512);
        cfg.schema_registry_url = Some("http://schema:8081".into());
        let s = serde_json::to_string(&cfg).unwrap();
        let v: Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["saslMechanism"], "SCRAM-SHA-512");
        assert_eq!(v["schemaRegistryURL"], "http://schema:8081");
        let back: ConnectionConfig = serde_json::from_str(&s).unwrap();
        assert_eq!(cfg, back);
    }

    #[test]
    fn file_based_helpers() {
        let s = ConnectionConfig::new("x", DatabaseKind::Sqlite);
        assert!(s.is_file_based());
        assert_eq!(s.default_port(), 0);
        let p = ConnectionConfig::new("y", DatabaseKind::Postgres);
        assert!(!p.is_file_based());
        assert_eq!(p.default_port(), 5432);
    }

    #[test]
    fn duckdb_file_based() {
        let d = ConnectionConfig::new("warehouse", DatabaseKind::Duckdb);
        assert!(d.is_file_based());
    }

    #[test]
    fn uses_ssh_tunnel_requires_non_empty_host() {
        let mut cfg = ConnectionConfig::new("pg", DatabaseKind::Postgres);
        assert!(!cfg.uses_ssh_tunnel());
        cfg.ssh_host = Some(String::new());
        assert!(!cfg.uses_ssh_tunnel());
        cfg.ssh_host = Some("bastion.example.com".into());
        assert!(cfg.uses_ssh_tunnel());
    }

    #[test]
    fn uses_ssh_tunnel_never_for_file_based() {
        let mut cfg = ConnectionConfig::new("lite", DatabaseKind::Sqlite);
        cfg.ssh_host = Some("bastion.example.com".into());
        assert!(!cfg.uses_ssh_tunnel());
        let mut duck = ConnectionConfig::new("duck", DatabaseKind::Duckdb);
        duck.ssh_host = Some("bastion.example.com".into());
        assert!(!duck.uses_ssh_tunnel());
    }
}
