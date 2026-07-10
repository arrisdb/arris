use std::fs::File;
use std::io::{BufReader, Cursor, Read};
use std::path::Path;
use std::sync::Arc;

use chacha20poly1305::aead::Aead;
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use datafusion::arrow::ipc::reader::StreamReader;
use datafusion::arrow::record_batch::RecordBatch;

use super::constants::{SPILL_KEY_LEN, SPILL_NONCE_LEN};
use super::errors::CanvasError;
use super::impl_spill_writer::SpillWriter;

/// Encrypts each cached-cell spill file with a random per-session key held ONLY
/// in memory (never persisted). The key dies with the process, so a spill file
/// left behind by a crash is cryptographically inert and the startup purge just
/// tidies it up. XChaCha20-Poly1305 with a fresh random 192-bit nonce per frame.
#[derive(Clone)]
pub(super) struct SpillCipher {
    key: Arc<[u8; SPILL_KEY_LEN]>,
}

impl SpillCipher {
    pub(super) fn new() -> Result<Self, CanvasError> {
        let mut key = [0u8; SPILL_KEY_LEN];
        getrandom::getrandom(&mut key).map_err(|e| CanvasError::Encryption(e.to_string()))?;
        Ok(Self { key: Arc::new(key) })
    }

    fn cipher(&self) -> XChaCha20Poly1305 {
        XChaCha20Poly1305::new_from_slice(self.key.as_ref()).expect("32-byte key")
    }

    /// Encrypt `plaintext` into `nonce || ciphertext+tag`.
    pub(super) fn seal(&self, plaintext: &[u8]) -> Result<Vec<u8>, CanvasError> {
        let mut nonce = [0u8; SPILL_NONCE_LEN];
        getrandom::getrandom(&mut nonce).map_err(|e| CanvasError::Encryption(e.to_string()))?;
        let ciphertext = self
            .cipher()
            .encrypt(XNonce::from_slice(&nonce), plaintext)
            .map_err(|e| CanvasError::Encryption(e.to_string()))?;
        let mut out = Vec::with_capacity(SPILL_NONCE_LEN + ciphertext.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    /// Decrypt a `nonce || ciphertext+tag` blob (fails on a wrong key or tamper).
    pub(super) fn open(&self, blob: &[u8]) -> Result<Vec<u8>, CanvasError> {
        if blob.len() < SPILL_NONCE_LEN {
            return Err(CanvasError::Encryption("spill frame too short".into()));
        }
        let (nonce, ciphertext) = blob.split_at(SPILL_NONCE_LEN);
        self.cipher()
            .decrypt(XNonce::from_slice(nonce), ciphertext)
            .map_err(|_| CanvasError::Encryption("spill decryption failed".into()))
    }

    /// A streaming encrypted writer at `path`.
    pub(super) fn writer(&self, path: &Path) -> Result<SpillWriter, CanvasError> {
        SpillWriter::create(self.clone(), path)
    }

    /// Encrypt a whole batch set to `path` (the whole-tier spill path).
    pub(super) fn encrypt_to_file(
        &self,
        path: &Path,
        batches: &[RecordBatch],
    ) -> Result<(), CanvasError> {
        let mut writer = self.writer(path)?;
        for batch in batches {
            writer.write(batch)?;
        }
        writer.finish()
    }

    /// Read and decrypt every batch back from a spill file. Reads frames
    /// sequentially (no seek), stopping at a clean end of file.
    pub(super) fn decrypt_from_file(&self, path: &Path) -> Result<Vec<RecordBatch>, CanvasError> {
        let file = File::open(path).map_err(|e| CanvasError::Io(e.to_string()))?;
        let mut reader = BufReader::new(file);
        let mut out = Vec::new();
        loop {
            let mut len_buf = [0u8; 4];
            match reader.read_exact(&mut len_buf) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
                Err(e) => return Err(CanvasError::Io(e.to_string())),
            }
            let len = u32::from_le_bytes(len_buf) as usize;
            let mut blob = vec![0u8; len];
            reader
                .read_exact(&mut blob)
                .map_err(|e| CanvasError::Io(e.to_string()))?;
            let plaintext = self.open(&blob)?;
            let stream = StreamReader::try_new(Cursor::new(plaintext), None)
                .map_err(|e| CanvasError::Arrow(e.to_string()))?;
            for batch in stream {
                out.push(batch.map_err(|e| CanvasError::Arrow(e.to_string()))?);
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use datafusion::arrow::array::Int64Array;
    use datafusion::arrow::datatypes::{DataType, Field, Schema};

    use super::*;

    static DIR_SEQ: AtomicU64 = AtomicU64::new(0);

    fn spill_path() -> std::path::PathBuf {
        let n = DIR_SEQ.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("arris-spill-{}-{}.bin", std::process::id(), n))
    }

    fn batch(values: &[i64]) -> RecordBatch {
        let schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, false)]));
        RecordBatch::try_new(schema, vec![Arc::new(Int64Array::from(values.to_vec()))]).unwrap()
    }

    fn all_i64(batches: &[RecordBatch]) -> Vec<i64> {
        let mut out = Vec::new();
        for b in batches {
            let arr = b.column(0).as_any().downcast_ref::<Int64Array>().unwrap();
            (0..arr.len()).for_each(|i| out.push(arr.value(i)));
        }
        out
    }

    #[test]
    fn roundtrips_multiple_batches_through_an_encrypted_file() {
        let cipher = SpillCipher::new().unwrap();
        let path = spill_path();
        cipher
            .encrypt_to_file(&path, &[batch(&[1, 2]), batch(&[3, 4, 5])])
            .unwrap();
        let got = cipher.decrypt_from_file(&path).unwrap();
        assert_eq!(all_i64(&got), vec![1, 2, 3, 4, 5]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn the_file_on_disk_is_not_plaintext() {
        let cipher = SpillCipher::new().unwrap();
        let path = spill_path();
        // A recognizable marker that a plaintext Arrow file would contain ("ARROW1"
        // magic); the encrypted file must not.
        cipher.encrypt_to_file(&path, &[batch(&[42])]).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert!(
            !bytes.windows(6).any(|w| w == b"ARROW1"),
            "spill file must not contain the plaintext Arrow magic"
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_different_session_key_cannot_decrypt() {
        let writer = SpillCipher::new().unwrap();
        let path = spill_path();
        writer.encrypt_to_file(&path, &[batch(&[7])]).unwrap();
        let other = SpillCipher::new().unwrap();
        assert!(
            other.decrypt_from_file(&path).is_err(),
            "a spill sealed with one session key must not open under another"
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn tampering_with_the_ciphertext_is_detected() {
        let cipher = SpillCipher::new().unwrap();
        let sealed = cipher.seal(b"secret").unwrap();
        let mut bad = sealed.clone();
        *bad.last_mut().unwrap() ^= 0xff;
        assert!(cipher.open(&bad).is_err(), "AEAD tag must reject tamper");
    }
}
