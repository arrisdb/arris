use crate::connection::types::{DatabaseKind, PrefillField, PrefillKeys};

/// Top-level config keys that only a genuine SQLMesh `config.yaml` carries.
///
/// SQLMesh accepts a config with no `project` field, but every real project
/// declares at least one of these (a gateway, a default gateway/connection, or
/// `model_defaults`). The generic `project` key is deliberately excluded: a
/// plain app `config.yaml` (e.g. a Python tool) is valid YAML and may well have
/// `project:`, which is exactly the false positive this list prevents.
pub(super) const SQLMESH_CONFIG_MARKER_KEYS: &[&str] = &[
    "gateways",
    "default_gateway",
    "model_defaults",
    "default_connection",
    "default_test_connection",
    "default_scheduler",
    "model_naming",
    "physical_schema_mapping",
    "snapshot_ttl",
    "linter",
    "notification_targets",
    "before_all",
    "after_all",
];

pub(super) const CONFIG_FILES: &[&str] = &["config.yaml", "config.yml"];
pub(super) const GATEWAYS_KEY: &str = "gateways";
pub(super) const DEFAULT_GATEWAY_KEY: &str = "default_gateway";
pub(super) const GATEWAY_CONNECTION_KEY: &str = "connection";
pub(super) const CONNECTION_TYPE_KEY: &str = "type";
/// Connection name `sqlmesh-<gateway>`.
pub(super) const CONNECTION_NAME_PREFIX: &str = "sqlmesh-";

const POSTGRES_KEYS: PrefillKeys = &[
    ("host", PrefillField::Host),
    ("port", PrefillField::Port),
    ("user", PrefillField::User),
    ("database", PrefillField::Database),
];
const SNOWFLAKE_KEYS: PrefillKeys = &[
    ("account", PrefillField::Host),
    ("user", PrefillField::User),
    ("database", PrefillField::Database),
    ("warehouse", PrefillField::Option("warehouse")),
    ("role", PrefillField::Option("role")),
];
const BIGQUERY_KEYS: PrefillKeys = &[
    ("project", PrefillField::Database),
    ("keyfile", PrefillField::CredentialsFile),
    ("location", PrefillField::Location),
];
const DUCKDB_KEYS: PrefillKeys = &[("database", PrefillField::FilePath)];
const CLICKHOUSE_KEYS: PrefillKeys = &[
    ("host", PrefillField::Host),
    ("port", PrefillField::Port),
    ("username", PrefillField::User),
];
const TRINO_KEYS: PrefillKeys = &[
    ("host", PrefillField::Host),
    ("port", PrefillField::Port),
    ("user", PrefillField::User),
    ("catalog", PrefillField::Database),
];

/// sqlmesh connection `type` to Arris kind and the non-secret keys it carries.
pub(super) const GATEWAY_CONNECTIONS: &[(&str, DatabaseKind, PrefillKeys)] = &[
    ("postgres", DatabaseKind::Postgres, POSTGRES_KEYS),
    ("redshift", DatabaseKind::Redshift, POSTGRES_KEYS),
    ("snowflake", DatabaseKind::Snowflake, SNOWFLAKE_KEYS),
    ("bigquery", DatabaseKind::Bigquery, BIGQUERY_KEYS),
    ("duckdb", DatabaseKind::Duckdb, DUCKDB_KEYS),
    ("mysql", DatabaseKind::Mysql, POSTGRES_KEYS),
    ("mssql", DatabaseKind::Mssql, POSTGRES_KEYS),
    ("clickhouse", DatabaseKind::Clickhouse, CLICKHOUSE_KEYS),
    ("trino", DatabaseKind::Trino, TRINO_KEYS),
];
