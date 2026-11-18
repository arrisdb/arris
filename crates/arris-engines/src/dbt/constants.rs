use crate::connection::types::{DatabaseKind, PrefillField, PrefillKeys};

/// Manifest schema major versions this parser has been tested against.
///
/// `manifest.json`'s `metadata.dbt_schema_version` looks like
/// `https://schemas.getdbt.com/dbt/manifest/v12.json`. Versions outside this
/// range still parse (every field is optional) but the viewer surfaces a
/// non-blocking warning. Extend this list as new dbt releases are validated.
pub(super) const SUPPORTED_MANIFEST_SCHEMA_VERSIONS: &[u32] = &[10, 11, 12];

/// Unique-id prefix and node kind of dbt sources, which have no compiled SQL.
pub(super) const SOURCE_ID_PREFIX: &str = "source.";
pub(super) const SOURCE_KIND: &str = "source";

pub(super) const RUN_RESULTS_FILE: &str = "run_results.json";
pub(super) const DEFAULT_TARGET_DIR: &str = "target";
/// `run_results.json` node statuses (models report success, tests pass).
pub(super) const STATUS_SUCCESS: &str = "success";
pub(super) const STATUS_PASS: &str = "pass";
pub(super) const STATUS_SKIPPED: &str = "skipped";
pub(super) const STATUS_WARN: &str = "warn";

pub(super) const PROFILES_FILE: &str = "profiles.yml";
pub(super) const PROJECT_FILE: &str = "dbt_project.yml";
pub(super) const HOME_PROFILES_DIR: &str = ".dbt";
pub(super) const ENV_PROFILES_DIR: &str = "DBT_PROFILES_DIR";
pub(super) const PROFILE_TARGET_KEY: &str = "target";
pub(super) const PROFILE_OUTPUTS_KEY: &str = "outputs";
pub(super) const OUTPUT_TYPE_KEY: &str = "type";
/// Connection name `<profile>-<target>`.
pub(super) const CONNECTION_NAME_SEPARATOR: &str = "-";

const POSTGRES_KEYS: PrefillKeys = &[
    ("host", PrefillField::Host),
    ("port", PrefillField::Port),
    ("user", PrefillField::User),
    ("dbname", PrefillField::Database),
    ("database", PrefillField::Database),
];
const SNOWFLAKE_KEYS: PrefillKeys = &[
    ("account", PrefillField::Host),
    ("user", PrefillField::User),
    ("database", PrefillField::Database),
    ("warehouse", PrefillField::Option("warehouse")),
    ("role", PrefillField::Option("role")),
    ("schema", PrefillField::Option("schema")),
];
const BIGQUERY_KEYS: PrefillKeys = &[
    ("project", PrefillField::Database),
    ("database", PrefillField::Database),
    ("keyfile", PrefillField::CredentialsFile),
    ("location", PrefillField::Location),
];
const DUCKDB_KEYS: PrefillKeys = &[("path", PrefillField::FilePath)];
/// dbt-mysql and dbt-clickhouse call the database `schema`.
const MYSQL_KEYS: PrefillKeys = &[
    ("server", PrefillField::Host),
    ("host", PrefillField::Host),
    ("port", PrefillField::Port),
    ("username", PrefillField::User),
    ("user", PrefillField::User),
    ("database", PrefillField::Database),
    ("schema", PrefillField::Database),
];
const SQLSERVER_KEYS: PrefillKeys = &[
    ("server", PrefillField::Host),
    ("host", PrefillField::Host),
    ("port", PrefillField::Port),
    ("user", PrefillField::User),
    ("username", PrefillField::User),
    ("database", PrefillField::Database),
];
const TRINO_KEYS: PrefillKeys = &[
    ("host", PrefillField::Host),
    ("port", PrefillField::Port),
    ("user", PrefillField::User),
    ("database", PrefillField::Database),
    ("schema", PrefillField::Option("schema")),
];

/// dbt adapter `type` to Arris kind and the non-secret keys it carries.
pub(super) const PROFILE_ADAPTERS: &[(&str, DatabaseKind, PrefillKeys)] = &[
    ("postgres", DatabaseKind::Postgres, POSTGRES_KEYS),
    ("redshift", DatabaseKind::Redshift, POSTGRES_KEYS),
    ("snowflake", DatabaseKind::Snowflake, SNOWFLAKE_KEYS),
    ("bigquery", DatabaseKind::Bigquery, BIGQUERY_KEYS),
    ("duckdb", DatabaseKind::Duckdb, DUCKDB_KEYS),
    ("mysql", DatabaseKind::Mysql, MYSQL_KEYS),
    ("sqlserver", DatabaseKind::Mssql, SQLSERVER_KEYS),
    ("clickhouse", DatabaseKind::Clickhouse, MYSQL_KEYS),
    ("trino", DatabaseKind::Trino, TRINO_KEYS),
];
