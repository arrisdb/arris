/// Target rows per streamed chunk; bounds ingestion memory to O(chunk).
pub const STREAM_CHUNK_ROWS: usize = 8_192;

/// Chunk capacity of the channel between a driver's fetch task and the
/// ingestion loop; keeps backpressure on the wire read.
pub const STREAM_CHUNK_CHANNEL_CAPACITY: usize = 2;
