//! StarRocks driver — speaks the MySQL wire protocol, so it rides on the
//! pure-Rust `mysql_async` crate over tokio (same transport as the `mysql`
//! driver). Differences from MySQL live in this module:
//! - Schema browser walks StarRocks' `information_schema` (databases → tables /
//!   views / materialized views → columns); it has no user routines, triggers,
//!   or events.
//! - `explain_query` returns StarRocks' text plan (`EXPLAIN` / `EXPLAIN
//!   ANALYZE`); StarRocks does not support `EXPLAIN FORMAT=JSON`.
//! - `object_definition` uses `SHOW CREATE {TABLE|VIEW|MATERIALIZED VIEW}`.
//! - `primary_key` is derived from the `SHOW CREATE TABLE` DDL because
//!   `information_schema.key_column_usage` is an empty placeholder.
//! - StarRocks has no interactive transactions, so the manual-transaction
//!   methods report `Unsupported`.

mod convert;
mod impl_starrocks_driver;
mod types;

pub use impl_starrocks_driver::StarrocksDriver;
