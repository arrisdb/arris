// Central constants for the Mixpanel driver module. Bounded to the module by the
// private `mod constants;` declaration; referenced as `super::constants::*`.

// Mixpanel HTTP API bases.
pub const EXPORT_BASE_URL: &str = "https://data.mixpanel.com/api/2.0/export";
pub const QUERY_API_BASE: &str = "https://mixpanel.com/api/query";
pub const SCHEMAS_API_BASE: &str = "https://mixpanel.com/api/app/projects";

// Schema-tree root.
pub const MP_ROOT_NAME: &str = "Mixpanel";
pub const MP_ROOT_PATH: &str = "mixpanel";

// The single logical table every query targets (`FROM events`).
pub const EVENTS_TABLE: &str = "events";

// Discovery limits.
pub const MAX_PROPERTY_FETCHES: usize = 50;
pub const SCHEMA_SAMPLE_LIMIT: usize = 1000;
pub const SCHEMA_SAMPLE_DAYS: i64 = 30;

// Query-result column type hints, inferred from the first row's cell value.
pub const TYPE_HINT_BIGINT: &str = "bigint";
pub const TYPE_HINT_DOUBLE: &str = "double";
pub const TYPE_HINT_BOOLEAN: &str = "boolean";
pub const TYPE_HINT_TEXT: &str = "text";

// The export endpoint requires an explicit from_date/to_date window and rejects
// any from_date earlier than 2011-07-10 (HTTP 400). Anchoring to that floor
// expresses "unlimited" unless a WHERE clause on `time` narrows the range.
pub const EARLIEST_EXPORT_DATE: &str = "2011-07-10";
