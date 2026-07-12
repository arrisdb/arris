use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use arris_engines::{CanvasEngine, CellResultCache};

pub const BOARD: &str = "board-stream";

static STREAM_DIR_SEQ: AtomicU64 = AtomicU64::new(0);

/// A canvas engine over a throwaway cell cache (1 GiB memory / 10 GiB total).
pub fn canvas_engine(prefix: &str) -> CanvasEngine {
    let n = STREAM_DIR_SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "arris-{prefix}-stream-{}-{}",
        std::process::id(),
        n
    ));
    let cache = CellResultCache::new(dir, 1 << 30, 10 * (1 << 30));
    CanvasEngine::new(Arc::new(cache))
}
