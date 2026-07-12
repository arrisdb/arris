/// Streaming fetch format: line 1 is the column names array, line 2 the ClickHouse
/// types array, then one JSON row array per line, so results parse as they arrive.
pub(super) const STREAM_FORMAT: &str = "JSONCompactEachRowWithNamesAndTypes";
