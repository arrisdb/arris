//! Leaf row-shape aliases for decoding StarRocks `information_schema` queries
//! via `mysql_async`'s tuple `FromRow`. No behavior lives here.

/// `(TABLE_NAME, TABLE_TYPE)` from `information_schema.tables`.
pub(super) type StarrocksTableRow = (String, String);

/// `TABLE_NAME` from `information_schema.views` (regular logical views only;
/// async materialized views are absent here, which is how they are told apart
/// from plain views — both show as `TABLE_TYPE = 'VIEW'` in `tables`).
pub(super) type StarrocksViewRow = String;

/// `(TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE)` from
/// `information_schema.columns`.
pub(super) type StarrocksColumnRow = (String, String, String, String);
