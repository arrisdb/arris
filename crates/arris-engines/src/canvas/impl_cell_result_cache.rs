use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use datafusion::arrow::record_batch::RecordBatch;

use super::constants::CELL_INGEST_BYTE_BUDGET;
use super::errors::CanvasError;
use super::impl_cell_cache_writer::CellCacheWriter;
use super::impl_spill_cipher::SpillCipher;
use super::impl_spill_writer::SpillWriter;

/// Where one cached cell result physically lives.
enum Store {
    /// Hot tier: batches kept in memory.
    Mem(Vec<RecordBatch>),
    /// Cold tier: spilled to an Arrow IPC file; read back from disk on demand.
    Disk(PathBuf),
}

struct Entry {
    bytes: usize,
    store: Store,
}

struct Inner {
    entries: HashMap<String, Entry>,
    /// LRU order: front = least-recently-used, back = most-recently-touched.
    order: Vec<String>,
    mem_bytes: usize,
    disk_bytes: usize,
    /// Monotonic suffix for spill filenames (avoids needing a clock/RNG).
    seq: u64,
}

/// A per-board cache of query-cell results, stored as Arrow so a downstream cell
/// can read an upstream cell's output back through a DataFusion `MemTable`.
///
/// Two tiers: a hot in-memory tier bounded by `mem_budget`, and a cold on-disk
/// Arrow IPC tier. The COMBINED footprint is hard-capped at `total_budget`;
/// crossing it evicts least-recently-used cells (the newest is always kept).
/// Keyed by the sanitized cell title.
pub struct CellResultCache {
    inner: Mutex<Inner>,
    mem_budget: usize,
    total_budget: usize,
    spill_dir: PathBuf,
    /// Per-session cipher: spill files are encrypted at rest under a random key
    /// held only in memory for this process.
    cipher: SpillCipher,
}

impl CellResultCache {
    pub fn new(spill_dir: PathBuf, mem_budget: usize, total_budget: usize) -> Self {
        Self {
            inner: Mutex::new(Inner {
                entries: HashMap::new(),
                order: Vec::new(),
                mem_bytes: 0,
                disk_bytes: 0,
                seq: 0,
            }),
            mem_budget,
            total_budget,
            spill_dir,
            cipher: SpillCipher::new().expect("spill cipher key generation"),
        }
    }

    fn batches_bytes(batches: &[RecordBatch]) -> usize {
        batches.iter().map(|b| b.get_array_memory_size()).sum()
    }

    /// Move `key` to the most-recently-used position.
    fn touch(order: &mut Vec<String>, key: &str) {
        if let Some(pos) = order.iter().position(|k| k == key) {
            order.remove(pos);
        }
        order.push(key.to_string());
    }

    /// Drop an entry, releasing its memory/disk accounting and deleting its spill
    /// file if it had one.
    fn remove_locked(inner: &mut Inner, key: &str) {
        if let Some(entry) = inner.entries.remove(key) {
            match &entry.store {
                Store::Mem(_) => inner.mem_bytes -= entry.bytes,
                Store::Disk(path) => {
                    inner.disk_bytes -= entry.bytes;
                    let _ = std::fs::remove_file(path);
                }
            }
            if let Some(pos) = inner.order.iter().position(|k| k == key) {
                inner.order.remove(pos);
            }
        }
    }

    /// Spill one in-memory entry to an Arrow IPC file, moving its bytes from the
    /// memory tier to the disk tier. No-op if the entry is already on disk.
    fn spill_locked(
        inner: &mut Inner,
        key: &str,
        spill_dir: &Path,
        cipher: &SpillCipher,
    ) -> Result<(), CanvasError> {
        let batches = match inner.entries.get(key).map(|e| &e.store) {
            Some(Store::Mem(b)) => b.clone(),
            _ => return Ok(()),
        };
        std::fs::create_dir_all(spill_dir).map_err(|e| CanvasError::Io(e.to_string()))?;
        inner.seq += 1;
        let path = spill_dir.join(format!("cell-{}.arrow", inner.seq));
        cipher.encrypt_to_file(&path, &batches)?;
        if let Some(entry) = inner.entries.get_mut(key) {
            inner.mem_bytes -= entry.bytes;
            inner.disk_bytes += entry.bytes;
            entry.store = Store::Disk(path);
        }
        Ok(())
    }

    /// Bring both tiers back within budget: first spill the coldest in-memory
    /// entries until the memory tier fits, then evict the coldest entries
    /// outright until the combined footprint fits (always keeping the newest).
    fn enforce(
        inner: &mut Inner,
        mem_budget: usize,
        total_budget: usize,
        spill_dir: &Path,
        cipher: &SpillCipher,
    ) -> Result<(), CanvasError> {
        while inner.mem_bytes > mem_budget {
            let coldest_mem = inner
                .order
                .iter()
                .find(|k| matches!(inner.entries.get(*k).map(|e| &e.store), Some(Store::Mem(_))))
                .cloned();
            let Some(key) = coldest_mem else { break };
            Self::spill_locked(inner, &key, spill_dir, cipher)?;
        }
        while inner.mem_bytes + inner.disk_bytes > total_budget && inner.order.len() > 1 {
            let Some(victim) = inner.order.first().cloned() else {
                break;
            };
            Self::remove_locked(inner, &victim);
        }
        Ok(())
    }

    /// Store (or replace) a cell's result. Inserts into the memory tier, then
    /// enforces the budgets (spill/evict as needed). An empty batch set is a
    /// no-op (nothing to cache).
    pub fn put(&self, key: &str, batches: Vec<RecordBatch>) -> Result<(), CanvasError> {
        if batches.is_empty() {
            return Ok(());
        }
        let bytes = Self::batches_bytes(&batches);
        let mut inner = self.inner.lock().unwrap();
        Self::remove_locked(&mut inner, key);
        inner.entries.insert(
            key.to_string(),
            Entry {
                bytes,
                store: Store::Mem(batches),
            },
        );
        inner.mem_bytes += bytes;
        Self::touch(&mut inner.order, key);
        Self::enforce(&mut inner, self.mem_budget, self.total_budget, &self.spill_dir, &self.cipher)?;
        Ok(())
    }

    /// Open an appendable writer for a cell's result so streamed batches land in
    /// the cache incrementally, capped at `CELL_INGEST_BYTE_BUDGET`.
    pub fn begin(self: &Arc<Self>, key: &str) -> CellCacheWriter {
        self.begin_with_budget(key, CELL_INGEST_BYTE_BUDGET)
    }

    /// `begin` with an explicit byte budget (tests shrink it to force the
    /// truncated, `complete: false` path).
    pub fn begin_with_budget(self: &Arc<Self>, key: &str, budget: usize) -> CellCacheWriter {
        CellCacheWriter::new(self.clone(), key.to_string(), budget)
    }

    /// The memory-tier budget; a writer past this spills to disk mid-stream.
    pub(super) fn mem_budget(&self) -> usize {
        self.mem_budget
    }

    /// Reserve a fresh spill-file path (creates the spill dir).
    pub(super) fn next_spill_path(&self) -> Result<PathBuf, CanvasError> {
        std::fs::create_dir_all(&self.spill_dir).map_err(|e| CanvasError::Io(e.to_string()))?;
        let mut inner = self.inner.lock().unwrap();
        inner.seq += 1;
        Ok(self.spill_dir.join(format!("cell-{}.arrow", inner.seq)))
    }

    /// A streaming encrypted writer for a reserved spill path (used by
    /// `CellCacheWriter` for mid-stream spills).
    pub(super) fn spill_writer(&self, path: &Path) -> Result<SpillWriter, CanvasError> {
        self.cipher.writer(path)
    }

    /// Drop every cached entry and delete the whole spill directory. Called on a
    /// clean shutdown so no cached query data lingers on disk between runs.
    pub fn purge(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.entries.clear();
        inner.order.clear();
        inner.mem_bytes = 0;
        inner.disk_bytes = 0;
        let _ = std::fs::remove_dir_all(&self.spill_dir);
    }

    /// Register a result a writer already spilled to `path` as a disk-tier
    /// entry, then enforce the budgets.
    pub(super) fn insert_spilled(
        &self,
        key: &str,
        path: PathBuf,
        bytes: usize,
    ) -> Result<(), CanvasError> {
        let mut inner = self.inner.lock().unwrap();
        Self::remove_locked(&mut inner, key);
        inner.entries.insert(
            key.to_string(),
            Entry {
                bytes,
                store: Store::Disk(path),
            },
        );
        inner.disk_bytes += bytes;
        Self::touch(&mut inner.order, key);
        Self::enforce(&mut inner, self.mem_budget, self.total_budget, &self.spill_dir, &self.cipher)
    }

    /// Fetch a cell's cached result, reading it back from disk if it was spilled.
    /// Marks the entry most-recently-used. `None` if absent (never run, or evicted).
    pub fn get(&self, key: &str) -> Result<Option<Vec<RecordBatch>>, CanvasError> {
        let mut inner = self.inner.lock().unwrap();
        let batches = match inner.entries.get(key).map(|e| &e.store) {
            None => return Ok(None),
            Some(Store::Mem(b)) => b.clone(),
            Some(Store::Disk(path)) => self.cipher.decrypt_from_file(&path.clone())?,
        };
        Self::touch(&mut inner.order, key);
        Ok(Some(batches))
    }

    pub fn contains(&self, key: &str) -> bool {
        self.inner.lock().unwrap().entries.contains_key(key)
    }

    pub fn remove(&self, key: &str) {
        let mut inner = self.inner.lock().unwrap();
        Self::remove_locked(&mut inner, key);
    }

    #[cfg(test)]
    pub(super) fn is_on_disk(&self, key: &str) -> bool {
        matches!(
            self.inner.lock().unwrap().entries.get(key).map(|e| &e.store),
            Some(Store::Disk(_))
        )
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    use datafusion::arrow::array::{Int64Array, StringArray};
    use datafusion::arrow::datatypes::{DataType, Field, Schema};

    use super::*;

    const BIG: usize = 1 << 30;

    static DIR_SEQ: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        let n = DIR_SEQ.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("arris-cellcache-{}-{}", std::process::id(), n))
    }

    fn batch(values: &[i64]) -> RecordBatch {
        let schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, false)]));
        RecordBatch::try_new(schema, vec![Arc::new(Int64Array::from(values.to_vec()))]).unwrap()
    }

    fn text_batch(values: &[&str]) -> RecordBatch {
        let schema = Arc::new(Schema::new(vec![Field::new("s", DataType::Utf8, false)]));
        let arr = StringArray::from(values.to_vec());
        RecordBatch::try_new(schema, vec![Arc::new(arr)]).unwrap()
    }

    fn first_col_i64(batches: &[RecordBatch]) -> Vec<i64> {
        let mut out = Vec::new();
        for b in batches {
            let arr = b
                .column(0)
                .as_any()
                .downcast_ref::<Int64Array>()
                .unwrap();
            for i in 0..arr.len() {
                out.push(arr.value(i));
            }
        }
        out
    }

    #[test]
    fn put_then_get_roundtrips_the_batches() {
        let cache = CellResultCache::new(temp_dir(), BIG, BIG);
        cache.put("a", vec![batch(&[1, 2, 3])]).unwrap();
        let got = cache.get("a").unwrap().unwrap();
        assert_eq!(first_col_i64(&got), vec![1, 2, 3]);
        assert!(cache.contains("a"));
        assert!(!cache.is_on_disk("a"));
    }

    #[test]
    fn re_putting_a_key_replaces_the_prior_result() {
        let cache = CellResultCache::new(temp_dir(), BIG, BIG);
        cache.put("a", vec![batch(&[1])]).unwrap();
        cache.put("a", vec![batch(&[9, 9])]).unwrap();
        let got = cache.get("a").unwrap().unwrap();
        assert_eq!(first_col_i64(&got), vec![9, 9]);
    }

    #[test]
    fn over_the_memory_budget_spills_to_disk_but_stays_readable() {
        // A 1-byte memory budget forces every entry to spill; the disk budget is
        // generous so nothing is evicted.
        let cache = CellResultCache::new(temp_dir(), 1, BIG);
        cache.put("a", vec![batch(&[1, 2])]).unwrap();
        cache.put("b", vec![text_batch(&["x", "y"])]).unwrap();
        assert!(cache.is_on_disk("a"));
        assert!(cache.is_on_disk("b"));
        // Both still return their original contents, read back from IPC.
        assert_eq!(first_col_i64(&cache.get("a").unwrap().unwrap()), vec![1, 2]);
        assert!(cache.contains("b"));
    }

    #[test]
    fn over_the_total_budget_evicts_least_recently_used() {
        // A 1-byte total budget keeps only the most-recent entry alive.
        let cache = CellResultCache::new(temp_dir(), 1, 1);
        cache.put("a", vec![batch(&[1])]).unwrap();
        cache.put("b", vec![batch(&[2])]).unwrap();
        assert!(!cache.contains("a"), "coldest entry should be evicted");
        assert!(cache.contains("b"), "newest entry is always kept");
        assert!(cache.get("a").unwrap().is_none());
    }

    #[test]
    fn purge_clears_entries_and_deletes_the_spill_directory() {
        // A 1-byte memory budget forces the entry onto disk.
        let dir = temp_dir();
        let cache = CellResultCache::new(dir.clone(), 1, BIG);
        cache.put("a", vec![batch(&[1, 2])]).unwrap();
        assert!(cache.is_on_disk("a"));
        assert!(dir.exists());
        cache.purge();
        assert!(!cache.contains("a"));
        assert!(cache.get("a").unwrap().is_none());
        assert!(!dir.exists(), "spill directory must be removed on purge");
    }

    #[test]
    fn get_marks_an_entry_recently_used_so_it_survives_eviction() {
        // Budget holds exactly two equal-sized entries; no memory spill.
        let unit = CellResultCache::batches_bytes(&[batch(&[1])]);
        let cache = CellResultCache::new(temp_dir(), BIG, unit * 2);
        cache.put("a", vec![batch(&[1])]).unwrap();
        cache.put("b", vec![batch(&[2])]).unwrap();
        // Read "a" so it becomes most-recently-used; "b" is now the coldest.
        let _ = cache.get("a").unwrap();
        cache.put("c", vec![batch(&[3])]).unwrap();
        // Inserting "c" overflows to three entries; the LRU victim is "b", not "a".
        assert!(cache.contains("a"), "recently-read entry survives");
        assert!(cache.contains("c"), "newest entry survives");
        assert!(!cache.contains("b"), "coldest entry is evicted");
    }
}
