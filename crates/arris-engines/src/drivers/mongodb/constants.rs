/// Aggregation stages that write their output to a collection.
pub(super) const WRITE_STAGES: [&str; 2] = ["$out", "$merge"];

/// Shell line-comment marker.
pub const LINE_COMMENT: &str = "//";
