/// `options` string format the Snowflake and Trino drivers parse: `k=v&k=v`.
pub(super) const OPTION_SEPARATOR: &str = "&";
pub(super) const OPTION_ASSIGN: &str = "=";
/// Jinja opener; templated values such as `env_var(...)` are never copied.
pub(super) const JINJA_OPEN: &str = "{{";
