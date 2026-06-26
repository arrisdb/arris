use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Shared, cheaply-clonable handle to the debug-logging subsystem. Owns the
/// runtime on/off flag (toggled live from the preferences save command) and the
/// directory logs are written to. The same `enabled` flag is shared with the
/// file writer, so flipping it takes effect without a restart.
#[derive(Clone)]
pub struct DebugLogHandle {
    enabled: Arc<AtomicBool>,
    dir: PathBuf,
}

impl DebugLogHandle {
    pub fn new(dir: PathBuf, enabled: bool) -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(enabled)),
            dir,
        }
    }

    pub fn set_enabled(&self, on: bool) {
        self.enabled.store(on, Ordering::Relaxed);
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn logs_dir(&self) -> &Path {
        &self.dir
    }

    pub(super) fn enabled_flag(&self) -> Arc<AtomicBool> {
        self.enabled.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handle_toggle_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let h = DebugLogHandle::new(tmp.path().to_path_buf(), false);
        assert!(!h.is_enabled());
        h.set_enabled(true);
        assert!(h.is_enabled());
        assert_eq!(h.logs_dir(), tmp.path());
        // Cloned handle shares the same flag.
        let h2 = h.clone();
        h.set_enabled(false);
        assert!(!h2.is_enabled());
    }
}
