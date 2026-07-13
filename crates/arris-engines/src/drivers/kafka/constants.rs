//! Constants for the Kafka driver.

use std::time::Duration;

/// Row cap for the buffered path (`GROUP BY` / `ORDER BY`), which must hold the
/// whole result in memory to aggregate or sort. The streaming path is uncapped.
pub(super) const MAX_ROWS: usize = 10_000;

/// Overall budget for draining a topic before giving up waiting for more.
pub(super) const CONSUME_TIMEOUT: Duration = Duration::from_secs(30);

/// Timeout for metadata / group-list fetches.
pub(super) const METADATA_TIMEOUT: Duration = Duration::from_secs(10);

/// Longest single `poll` wait; keeps the deadline check responsive.
pub(super) const POLL_INTERVAL: Duration = Duration::from_millis(1000);

/// Consecutive empty polls (after at least one row) that mean the topic is drained.
pub(super) const EMPTY_POLLS_BEFORE_STOP: u32 = 2;

/// Idle-poll backstop for the watermark-terminated stream: stop after this many
/// empty polls even if a partition never reaches its high watermark (offset gaps
/// from log compaction/retention would otherwise loop forever).
pub(super) const WATERMARK_IDLE_POLLS_BEFORE_STOP: u32 = 5;

/// Bound on the row hand-off channel from the blocking poll task to the async
/// chunker, so a slow consumer backpressures the poll loop instead of buffering
/// the whole topic in memory.
pub(super) const STREAM_ROW_CHANNEL_CAPACITY: usize = 8_192;
