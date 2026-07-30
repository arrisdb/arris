/// Rejected when a driver hands federation an Arrow stream; no driver emits one
/// yet, so scans have no Arrow-to-row conversion path.
pub(super) const ARROW_SCAN_UNSUPPORTED: &str =
    "Federated scans cannot read an Arrow result stream from this source";

/// Tables are registered with an already-probed schema, so the executor's
/// catalog-discovery methods are never called.
pub(super) const EXECUTOR_CATALOG_UNSUPPORTED: &str =
    "Federated tables are registered with a known schema; this executor does not browse catalogs";

/// Physical node `datafusion-federation` emits for a pushed-down subplan.
pub(super) const FEDERATION_EXEC_NAME: &str = "sql_federation_exec";

/// Connection marker in that node's display; the only handle it exposes.
pub(super) const FEDERATION_EXEC_NAME_KEY: &str = " name=";
