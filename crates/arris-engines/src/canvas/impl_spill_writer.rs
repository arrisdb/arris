use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

use datafusion::arrow::ipc::writer::StreamWriter;
use datafusion::arrow::record_batch::RecordBatch;

use super::errors::CanvasError;
use super::impl_spill_cipher::SpillCipher;

/// Streaming writer for one encrypted spill file: each `write` seals one Arrow
/// IPC batch into a length-prefixed frame, so huge cells stream without buffering.
pub(super) struct SpillWriter {
    cipher: SpillCipher,
    out: BufWriter<File>,
}

impl SpillWriter {
    pub(super) fn create(cipher: SpillCipher, path: &Path) -> Result<Self, CanvasError> {
        let file = File::create(path).map_err(|e| CanvasError::Io(e.to_string()))?;
        Ok(Self {
            cipher,
            out: BufWriter::new(file),
        })
    }

    /// Append one batch as an encrypted, length-prefixed frame.
    pub(super) fn write(&mut self, batch: &RecordBatch) -> Result<(), CanvasError> {
        let mut ipc = Vec::new();
        {
            let mut writer = StreamWriter::try_new(&mut ipc, &batch.schema())
                .map_err(|e| CanvasError::Arrow(e.to_string()))?;
            writer
                .write(batch)
                .map_err(|e| CanvasError::Arrow(e.to_string()))?;
            writer
                .finish()
                .map_err(|e| CanvasError::Arrow(e.to_string()))?;
        }
        let sealed = self.cipher.seal(&ipc)?;
        let len = u32::try_from(sealed.len())
            .map_err(|_| CanvasError::Encryption("spill frame too large".into()))?;
        self.out
            .write_all(&len.to_le_bytes())
            .map_err(|e| CanvasError::Io(e.to_string()))?;
        self.out
            .write_all(&sealed)
            .map_err(|e| CanvasError::Io(e.to_string()))?;
        Ok(())
    }

    /// Flush the buffered writer (surfacing any final write error).
    pub(super) fn finish(mut self) -> Result<(), CanvasError> {
        self.out.flush().map_err(|e| CanvasError::Io(e.to_string()))
    }
}
