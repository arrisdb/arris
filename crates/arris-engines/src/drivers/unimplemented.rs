//! Fallback driver returned for a `DatabaseKind` whose driver feature is
//! disabled in the current build. Every `DatabaseKind` arm in
//! `driver_for_kind` is `#[cfg(feature = "<kind>")]`-gated, so a feature-trimmed
//! build has no real arm for that kind and falls through to this driver. Every
//! trait method returns `DriverError::Other(...)` naming the kind, so the UI
//! surfaces a clear "driver unavailable" message instead of crashing.
//!
//! Unreachable in a default build, where every kind has its real driver arm.

use async_trait::async_trait;

use crate::{
    ConnectionConfig, DatabaseKind, DriverError, ExplainMode, MutationResult, PlanResult,
    QueryLanguage, QueryResult, QueryValue, RowDelete, RowInsert, SchemaNode, TableRef,
};
use crate::drivers::errors::Result;

use crate::drivers::DatabaseDriver;

pub struct UnimplementedDriver {
    kind: DatabaseKind,
}

impl UnimplementedDriver {
    pub fn new(kind: DatabaseKind) -> Self {
        Self { kind }
    }

    fn err<T>(&self) -> Result<T> {
        Err(DriverError::Other(format!(
            "Driver for {:?} is not available in this build (its driver feature is disabled).",
            self.kind
        )))
    }
}

#[async_trait]
impl DatabaseDriver for UnimplementedDriver {
    async fn connect(&self, _config: &ConnectionConfig) -> Result<()> {
        self.err()
    }
    async fn is_connected(&self) -> bool {
        false
    }
    async fn list_schemas(&self) -> Result<Vec<SchemaNode>> {
        self.err()
    }
    async fn list_schema(&self, _schema: &str) -> Result<Vec<SchemaNode>> {
        self.err()
    }
    async fn run_query(
        &self,
        _text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
    ) -> Result<QueryResult> {
        self.err()
    }
    async fn explain_query(
        &self,
        _text: &str,
        _params: &[QueryValue],
        _language: QueryLanguage,
        _mode: ExplainMode,
    ) -> Result<PlanResult> {
        self.err()
    }
    async fn primary_key(&self, _table: &TableRef) -> Result<Option<Vec<String>>> {
        self.err()
    }
    async fn update_row(
        &self,
        _table: &TableRef,
        _primary_key: &crate::ValueMap,
        _changes: &crate::ValueMap,
    ) -> Result<MutationResult> {
        self.err()
    }
    async fn insert_rows(&self, _table: &TableRef, _inserts: &[RowInsert]) -> Result<MutationResult> {
        self.err()
    }
    async fn delete_rows(&self, _table: &TableRef, _deletes: &[RowDelete]) -> Result<MutationResult> {
        self.err()
    }
    async fn close(&self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn returns_clear_error_on_run_query() {
        let d = UnimplementedDriver::new(DatabaseKind::Mongodb);
        let err = d
            .run_query("anything", &[], QueryLanguage::Native)
            .await
            .unwrap_err();
        let s = err.to_string();
        assert!(s.contains("Mongodb"));
        assert!(s.contains("not available in this build"));
    }

    #[tokio::test]
    async fn is_connected_false() {
        let d = UnimplementedDriver::new(DatabaseKind::Snowflake);
        assert!(!d.is_connected().await);
    }
}
