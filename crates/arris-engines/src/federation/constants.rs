/// Rejected when a driver hands federation an Arrow stream; no driver emits one
/// yet, so scans have no Arrow-to-row conversion path.
pub(super) const ARROW_SCAN_UNSUPPORTED: &str =
    "Federated scans cannot read an Arrow result stream from this source";
