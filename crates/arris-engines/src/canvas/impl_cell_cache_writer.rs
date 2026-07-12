use std::path::PathBuf;
use std::sync::Arc;

use datafusion::arrow::record_batch::RecordBatch;

use super::errors::CanvasError;
use super::impl_cell_result_cache::CellResultCache;
use super::impl_spill_writer::SpillWriter;

/// Appendable writer for one cell's streamed result: buffers in memory, spills
/// mid-stream past the memory budget; `append` refuses batches past the byte budget.
pub struct CellCacheWriter {
    cache: Arc<CellResultCache>,
    key: String,
    budget: usize,
    mem: Vec<RecordBatch>,
    file: Option<(PathBuf, SpillWriter)>,
    bytes: usize,
    rows: u64,
}

impl CellCacheWriter {
    pub(super) fn new(cache: Arc<CellResultCache>, key: String, budget: usize) -> Self {
        Self {
            cache,
            key,
            budget,
            mem: Vec::new(),
            file: None,
            bytes: 0,
            rows: 0,
        }
    }

    /// Move the buffered in-memory batches into a fresh IPC spill file; later
    /// appends stream straight to it.
    fn spill(&mut self) -> Result<(), CanvasError> {
        if self.mem.is_empty() {
            return Ok(());
        }
        let path = self.cache.next_spill_path()?;
        let mut writer = self.cache.spill_writer(&path)?;
        for batch in self.mem.drain(..) {
            writer.write(&batch)?;
        }
        self.file = Some((path, writer));
        Ok(())
    }

    /// Append one batch. Returns `Ok(false)` (batch NOT written) when writing
    /// it would cross the byte budget: the caller stops and finishes partial.
    pub fn append(&mut self, batch: RecordBatch) -> Result<bool, CanvasError> {
        if batch.num_rows() == 0 {
            return Ok(true);
        }
        let batch_bytes = batch.get_array_memory_size();
        if self.bytes + batch_bytes > self.budget {
            return Ok(false);
        }
        self.bytes += batch_bytes;
        self.rows += batch.num_rows() as u64;
        match &mut self.file {
            Some((_, writer)) => writer.write(&batch)?,
            None => {
                self.mem.push(batch);
                if self.bytes > self.cache.mem_budget() {
                    self.spill()?;
                }
            }
        }
        Ok(true)
    }

    /// Rows accepted so far (refused and empty batches not counted).
    pub fn rows(&self) -> u64 {
        self.rows
    }

    /// Close the writer, register the entry in the cache (an empty result
    /// registers nothing), and return the total rows written.
    pub fn finish(self) -> Result<u64, CanvasError> {
        match self.file {
            Some((path, writer)) => {
                writer.finish()?;
                self.cache.insert_spilled(&self.key, path, self.bytes)?;
            }
            None => {
                if !self.mem.is_empty() {
                    self.cache.put(&self.key, self.mem)?;
                }
            }
        }
        Ok(self.rows)
    }

    /// Discard everything written so far (the entry was never registered).
    pub fn abort(self) {
        if let Some((path, writer)) = self.file {
            drop(writer);
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use datafusion::arrow::array::Int64Array;
    use datafusion::arrow::datatypes::{DataType, Field, Schema};

    use super::*;

    const BIG: usize = 1 << 30;

    static DIR_SEQ: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        let n = DIR_SEQ.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("arris-cellwriter-{}-{}", std::process::id(), n))
    }

    fn cache(mem_budget: usize) -> Arc<CellResultCache> {
        Arc::new(CellResultCache::new(temp_dir(), mem_budget, BIG))
    }

    fn batch(values: &[i64]) -> RecordBatch {
        let schema = Arc::new(Schema::new(vec![Field::new("n", DataType::Int64, false)]));
        RecordBatch::try_new(schema, vec![Arc::new(Int64Array::from(values.to_vec()))]).unwrap()
    }

    fn first_col_i64(batches: &[RecordBatch]) -> Vec<i64> {
        let mut out = Vec::new();
        for b in batches {
            let arr = b.column(0).as_any().downcast_ref::<Int64Array>().unwrap();
            for i in 0..arr.len() {
                out.push(arr.value(i));
            }
        }
        out
    }

    #[test]
    fn append_and_finish_registers_a_readable_entry() {
        let cache = cache(BIG);
        let mut w = cache.begin("a", BIG);
        assert!(w.append(batch(&[1, 2])).unwrap());
        assert!(w.append(batch(&[3])).unwrap());
        assert_eq!(w.finish().unwrap(), 3);
        assert_eq!(first_col_i64(&cache.get("a").unwrap().unwrap()), vec![1, 2, 3]);
        assert!(!cache.is_on_disk("a"));
    }

    #[test]
    fn crossing_the_memory_budget_spills_mid_stream() {
        // A 1-byte memory tier forces the spill on the first append.
        let cache = cache(1);
        let mut w = cache.begin("a", BIG);
        assert!(w.append(batch(&[1, 2])).unwrap());
        assert!(w.append(batch(&[3, 4])).unwrap());
        assert_eq!(w.finish().unwrap(), 4);
        assert!(cache.is_on_disk("a"), "entry should be registered spilled");
        assert_eq!(
            first_col_i64(&cache.get("a").unwrap().unwrap()),
            vec![1, 2, 3, 4]
        );
    }

    #[test]
    fn byte_budget_refuses_the_overflowing_batch() {
        let cache = cache(BIG);
        let unit = batch(&[1]).get_array_memory_size();
        let mut w = cache.begin("a", unit);
        assert!(w.append(batch(&[1])).unwrap());
        assert!(!w.append(batch(&[2])).unwrap(), "second batch crosses budget");
        assert_eq!(w.finish().unwrap(), 1, "refused batch is not counted");
        assert_eq!(first_col_i64(&cache.get("a").unwrap().unwrap()), vec![1]);
    }

    #[test]
    fn abort_leaves_no_entry_and_removes_the_spill_file() {
        let cache = cache(1);
        let mut w = cache.begin("a", BIG);
        w.append(batch(&[1, 2])).unwrap();
        let spill_path = w.file.as_ref().map(|(p, _)| p.clone()).unwrap();
        assert!(spill_path.exists());
        w.abort();
        assert!(!cache.contains("a"));
        assert!(!spill_path.exists(), "aborted spill file must be deleted");
    }

    #[test]
    fn finishing_with_nothing_written_registers_no_entry() {
        let cache = cache(BIG);
        let w = cache.begin("a", BIG);
        assert_eq!(w.finish().unwrap(), 0);
        assert!(!cache.contains("a"));
    }

    #[test]
    fn empty_batches_are_skipped_but_not_counted() {
        let cache = cache(BIG);
        let mut w = cache.begin("a", BIG);
        assert!(w.append(batch(&[])).unwrap());
        assert!(w.append(batch(&[7])).unwrap());
        assert_eq!(w.finish().unwrap(), 1);
    }
}
