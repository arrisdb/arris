use std::fs::File;
use std::path::PathBuf;
use std::sync::Arc;

use datafusion::arrow::ipc::writer::FileWriter;
use datafusion::arrow::record_batch::RecordBatch;

use super::errors::CanvasError;
use super::impl_cell_result_cache::CellResultCache;
use super::types::CellWriteStats;

/// An appendable writer for one cell's streamed result. Batches accumulate in
/// memory until the cache's memory budget, then spill to an Arrow IPC file
/// mid-stream; `finish` registers the entry, `abort` discards everything.
/// A hard byte budget caps ingestion: `append` refuses the batch that would
/// cross it so the run can stop and report `complete: false`.
pub struct CellCacheWriter {
    cache: Arc<CellResultCache>,
    key: String,
    budget: usize,
    mem: Vec<RecordBatch>,
    file: Option<(PathBuf, FileWriter<File>)>,
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
        let Some(first) = self.mem.first() else {
            return Ok(());
        };
        let path = self.cache.next_spill_path()?;
        let file = File::create(&path).map_err(|e| CanvasError::Io(e.to_string()))?;
        let mut writer = FileWriter::try_new(file, &first.schema())
            .map_err(|e| CanvasError::Arrow(e.to_string()))?;
        for batch in self.mem.drain(..) {
            writer
                .write(&batch)
                .map_err(|e| CanvasError::Arrow(e.to_string()))?;
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
            Some((_, writer)) => writer
                .write(&batch)
                .map_err(|e| CanvasError::Arrow(e.to_string()))?,
            None => {
                self.mem.push(batch);
                if self.bytes > self.cache.mem_budget() {
                    self.spill()?;
                }
            }
        }
        Ok(true)
    }

    /// Close the writer and register the entry in the cache. An empty result
    /// registers nothing (same as `put` with no batches).
    pub fn finish(self) -> Result<CellWriteStats, CanvasError> {
        let stats = CellWriteStats {
            total_rows: self.rows,
            total_bytes: self.bytes,
        };
        match self.file {
            Some((path, mut writer)) => {
                writer
                    .finish()
                    .map_err(|e| CanvasError::Arrow(e.to_string()))?;
                self.cache.insert_spilled(&self.key, path, self.bytes)?;
            }
            None => {
                if !self.mem.is_empty() {
                    self.cache.put(&self.key, self.mem)?;
                }
            }
        }
        Ok(stats)
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
        let mut w = cache.begin("a");
        assert!(w.append(batch(&[1, 2])).unwrap());
        assert!(w.append(batch(&[3])).unwrap());
        let stats = w.finish().unwrap();
        assert_eq!(stats.total_rows, 3);
        assert!(stats.total_bytes > 0);
        assert_eq!(first_col_i64(&cache.get("a").unwrap().unwrap()), vec![1, 2, 3]);
        assert!(!cache.is_on_disk("a"));
    }

    #[test]
    fn crossing_the_memory_budget_spills_mid_stream() {
        // A 1-byte memory tier forces the spill on the first append.
        let cache = cache(1);
        let mut w = cache.begin("a");
        assert!(w.append(batch(&[1, 2])).unwrap());
        assert!(w.append(batch(&[3, 4])).unwrap());
        let stats = w.finish().unwrap();
        assert_eq!(stats.total_rows, 4);
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
        let mut w = cache.begin_with_budget("a", unit);
        assert!(w.append(batch(&[1])).unwrap());
        assert!(!w.append(batch(&[2])).unwrap(), "second batch crosses budget");
        let stats = w.finish().unwrap();
        assert_eq!(stats.total_rows, 1, "refused batch is not counted");
        assert_eq!(first_col_i64(&cache.get("a").unwrap().unwrap()), vec![1]);
    }

    #[test]
    fn abort_leaves_no_entry_and_removes_the_spill_file() {
        let cache = cache(1);
        let mut w = cache.begin("a");
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
        let w = cache.begin("a");
        let stats = w.finish().unwrap();
        assert_eq!(stats.total_rows, 0);
        assert!(!cache.contains("a"));
    }

    #[test]
    fn empty_batches_are_skipped_but_not_counted() {
        let cache = cache(BIG);
        let mut w = cache.begin("a");
        assert!(w.append(batch(&[])).unwrap());
        assert!(w.append(batch(&[7])).unwrap());
        let stats = w.finish().unwrap();
        assert_eq!(stats.total_rows, 1);
    }
}
