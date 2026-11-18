/// `options` string format the Snowflake and Trino drivers parse: `k=v&k=v`.
pub(super) const OPTION_SEPARATOR: &str = "&";
pub(super) const OPTION_ASSIGN: &str = "=";
/// Jinja opener; templated values such as `env_var(...)` are never copied.
pub(super) const JINJA_OPEN: &str = "{{";
/// Where a connection is saved: shared by every project, or this project only.
pub const CONNECTION_SCOPE_GLOBAL: &str = "global";
pub const CONNECTION_SCOPE_LOCAL: &str = "local";
/// URI schemes `arris connection new --url` accepts, and the kind each one opens.
pub(super) const URL_SCHEMES: &[(&str, super::DatabaseKind)] = &[
    ("postgres", super::DatabaseKind::Postgres),
    ("postgresql", super::DatabaseKind::Postgres),
    ("mongodb", super::DatabaseKind::Mongodb),
    (MONGODB_SRV_SCHEME, super::DatabaseKind::Mongodb),
    ("mysql", super::DatabaseKind::Mysql),
    ("mariadb", super::DatabaseKind::Mariadb),
    ("redis", super::DatabaseKind::Redis),
    ("redshift", super::DatabaseKind::Redshift),
    ("sqlserver", super::DatabaseKind::Mssql),
    ("clickhouse", super::DatabaseKind::Clickhouse),
    ("trino", super::DatabaseKind::Trino),
];
pub(super) const MONGODB_SRV_SCHEME: &str = "mongodb+srv";
/// What an unparsable `--url` is called in its error.
pub(super) const CONNECTION_URL_LABEL: &str = "connection URL";
pub(super) const URL_PATH_SEPARATOR: char = '/';
