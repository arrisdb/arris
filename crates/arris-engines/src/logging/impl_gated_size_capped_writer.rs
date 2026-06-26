use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tracing_subscriber::fmt::MakeWriter;

use super::constants::{LOG_FILE_NAME, ROTATED_FILE_NAME};

/// A single, size-capped log file. Opens lazily on first write, so when debug
/// mode is off (and no event is ever written) no file is created at all. When
/// the active file would exceed `cap`, it is rotated to `debug.log.1` (one
/// generation kept) and a fresh file is started.
pub(super) struct SizeCappedFile {
    path: PathBuf,
    rotated: PathBuf,
    cap: u64,
    file: Option<std::fs::File>,
    written: u64,
}

impl SizeCappedFile {
    pub(super) fn new(dir: PathBuf, cap: u64) -> Self {
        Self {
            path: dir.join(LOG_FILE_NAME),
            rotated: dir.join(ROTATED_FILE_NAME),
            cap,
            file: None,
            written: 0,
        }
    }

    fn ensure_open(&mut self) -> io::Result<()> {
        if self.file.is_none() {
            if let Some(parent) = self.path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let f = OpenOptions::new().create(true).append(true).open(&self.path)?;
            self.written = f.metadata().map(|m| m.len()).unwrap_or(0);
            self.file = Some(f);
        }
        Ok(())
    }

    fn rotate(&mut self) -> io::Result<()> {
        self.file = None; // close before rename
        let _ = std::fs::rename(&self.path, &self.rotated);
        let f = OpenOptions::new().create(true).append(true).open(&self.path)?;
        self.written = 0;
        self.file = Some(f);
        Ok(())
    }
}

impl Write for SizeCappedFile {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.ensure_open()?;
        if self.written > 0 && self.written + buf.len() as u64 > self.cap {
            self.rotate()?;
        }
        let n = self.file.as_mut().expect("file opened").write(buf)?;
        self.written += n as u64;
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        match self.file.as_mut() {
            Some(f) => f.flush(),
            None => Ok(()),
        }
    }
}

/// `MakeWriter` adapter gated by the shared `enabled` flag. When off, hands out
/// a no-op writer so the fmt layer formats nothing to disk.
#[derive(Clone)]
pub(super) struct GatedSizeCappedWriter {
    enabled: Arc<AtomicBool>,
    file: Arc<Mutex<SizeCappedFile>>,
}

impl GatedSizeCappedWriter {
    pub(super) fn new(dir: PathBuf, cap: u64, enabled: Arc<AtomicBool>) -> Self {
        Self {
            enabled,
            file: Arc::new(Mutex::new(SizeCappedFile::new(dir, cap))),
        }
    }
}

impl<'a> MakeWriter<'a> for GatedSizeCappedWriter {
    type Writer = DebugWriter;

    fn make_writer(&'a self) -> Self::Writer {
        if self.enabled.load(Ordering::Relaxed) {
            DebugWriter::File(self.file.clone())
        } else {
            DebugWriter::Disabled
        }
    }
}

pub(super) enum DebugWriter {
    File(Arc<Mutex<SizeCappedFile>>),
    Disabled,
}

impl Write for DebugWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            DebugWriter::File(f) => f.lock().expect("debug log mutex").write(buf),
            DebugWriter::Disabled => Ok(buf.len()),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self {
            DebugWriter::File(f) => f.lock().expect("debug log mutex").flush(),
            DebugWriter::Disabled => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::logging::constants::MAX_LOG_BYTES;

    #[test]
    fn size_capped_file_rotates_at_cap() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let mut f = SizeCappedFile::new(dir.clone(), 100);

        f.write_all(&[b'a'; 60]).unwrap();
        // No rotation yet: only one file, 60 bytes.
        assert!(dir.join("debug.log").exists());
        assert!(!dir.join("debug.log.1").exists());
        assert_eq!(std::fs::metadata(dir.join("debug.log")).unwrap().len(), 60);

        // This write would exceed the 100-byte cap -> rotate first, then write.
        f.write_all(&[b'b'; 60]).unwrap();
        f.flush().unwrap();
        assert_eq!(std::fs::metadata(dir.join("debug.log.1")).unwrap().len(), 60);
        assert_eq!(std::fs::metadata(dir.join("debug.log")).unwrap().len(), 60);
    }

    #[test]
    fn gated_writer_hands_out_noop_when_disabled() {
        let tmp = tempfile::tempdir().unwrap();
        let enabled = Arc::new(AtomicBool::new(false));
        let w = GatedSizeCappedWriter::new(tmp.path().to_path_buf(), MAX_LOG_BYTES, enabled.clone());
        // Disabled: write is a no-op, no file created.
        w.make_writer().write_all(b"ignored").unwrap();
        assert!(!tmp.path().join("debug.log").exists());
        // Enable, then it persists.
        enabled.store(true, std::sync::atomic::Ordering::Relaxed);
        w.make_writer().write_all(b"kept").unwrap();
        assert!(tmp.path().join("debug.log").exists());
    }
}
