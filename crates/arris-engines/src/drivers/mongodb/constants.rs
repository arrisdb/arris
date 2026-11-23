/// Aggregation stages that write their output to a collection.
pub(super) const WRITE_STAGES: [&str; 2] = ["$out", "$merge"];

/// Line-comment markers; the mongosh editor highlights both.
pub const LINE_COMMENTS: [&str; 2] = ["//", "--"];
