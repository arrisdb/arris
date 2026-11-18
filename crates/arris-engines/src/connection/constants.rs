/// `options` string format the Snowflake and Trino drivers parse: `k=v&k=v`.
pub(super) const OPTION_SEPARATOR: &str = "&";
pub(super) const OPTION_ASSIGN: &str = "=";
/// Jinja opener; templated values such as `env_var(...)` are never copied.
pub(super) const JINJA_OPEN: &str = "{{";
/// Where a connection is saved: shared by every project, or this project only.
pub const CONNECTION_SCOPE_GLOBAL: &str = "global";
pub const CONNECTION_SCOPE_LOCAL: &str = "local";
