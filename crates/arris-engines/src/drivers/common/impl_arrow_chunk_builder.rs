use std::sync::Arc;

use datafusion::arrow::array::{
    ArrayRef, BinaryArray, BooleanArray, Float64Array, Int64Array, StringBuilder,
};
use datafusion::arrow::datatypes::{DataType, Field, Schema, SchemaRef};
use datafusion::arrow::record_batch::{RecordBatch, RecordBatchOptions};

use crate::{ColumnSpec, QueryValue};

/// Converts row chunks into Arrow `RecordBatch`es with the one shared QueryValue
/// -> Arrow mapping; the schema locks on the first chunk (mismatches NULL out).
pub struct ArrowChunkBuilder {
    columns: Vec<ColumnSpec>,
    schema: Option<SchemaRef>,
}

impl ArrowChunkBuilder {
    pub fn new(columns: &[ColumnSpec]) -> Self {
        Self {
            columns: columns.to_vec(),
            schema: None,
        }
    }

    /// Convert one chunk of rows into a `RecordBatch`, locking the schema from
    /// the column specs plus this chunk's values on the first call.
    pub fn batch(&mut self, rows: &[Vec<QueryValue>]) -> Result<RecordBatch, String> {
        let schema = match &self.schema {
            Some(s) => s.clone(),
            None => {
                let s = Self::infer_schema(&self.columns, rows);
                self.schema = Some(s.clone());
                s
            }
        };
        if schema.fields().is_empty() {
            // A zero-column batch must carry an explicit row count.
            let options = RecordBatchOptions::new().with_row_count(Some(rows.len()));
            return RecordBatch::try_new_with_options(schema, vec![], &options)
                .map_err(|e| e.to_string());
        }
        let arrays: Vec<ArrayRef> = schema
            .fields()
            .iter()
            .enumerate()
            .map(|(i, field)| Self::build_array(field.data_type(), Some(i), rows))
            .collect();
        RecordBatch::try_new(schema, arrays).map_err(|e| e.to_string())
    }

    /// Infer an Arrow schema from column specs plus sample rows (first non-null
    /// value per column decides; all-null or no rows falls back to Utf8).
    pub(crate) fn infer_schema(columns: &[ColumnSpec], rows: &[Vec<QueryValue>]) -> SchemaRef {
        let fields: Vec<Field> = columns
            .iter()
            .enumerate()
            .map(|(i, col)| {
                let dt = Self::infer_arrow_type(col, i, rows);
                Field::new(&col.name, dt, true)
            })
            .collect();
        Arc::new(Schema::new(fields))
    }

    fn is_numeric_type_hint(hint: &str) -> bool {
        matches!(
            hint.to_lowercase().as_str(),
            "numeric"
                | "decimal"
                | "newdecimal"
                | "money"
                | "real"
                | "double precision"
                | "float"
                | "float4"
                | "float8"
                | "double"
                | "dec"
        )
    }

    fn infer_arrow_type(col: &ColumnSpec, col_idx: usize, rows: &[Vec<QueryValue>]) -> DataType {
        if Self::is_numeric_type_hint(&col.type_hint) {
            return DataType::Float64;
        }
        for row in rows {
            if let Some(val) = row.get(col_idx) {
                match val {
                    QueryValue::Null => continue,
                    QueryValue::Bool(_) => return DataType::Boolean,
                    QueryValue::Int(_) => return DataType::Int64,
                    QueryValue::Double(_) => return DataType::Float64,
                    QueryValue::Decimal(_) => return DataType::Float64,
                    QueryValue::Text(_) | QueryValue::Json(_) => return DataType::Utf8,
                    QueryValue::Data(_) => return DataType::Binary,
                }
            }
        }
        DataType::Utf8
    }

    /// Build one column array of `dt` from `rows[.][src_idx]`; a `None` index
    /// or a mismatched value yields NULL (numbers/bools stringify for Utf8).
    pub(crate) fn build_array(
        dt: &DataType,
        src_idx: Option<usize>,
        rows: &[Vec<QueryValue>],
    ) -> ArrayRef {
        match dt {
            DataType::Boolean => {
                let arr: BooleanArray = rows
                    .iter()
                    .map(|row| {
                        src_idx.and_then(|i| row.get(i)).and_then(|v| match v {
                            QueryValue::Bool(b) => Some(*b),
                            _ => None,
                        })
                    })
                    .collect();
                Arc::new(arr) as ArrayRef
            }
            DataType::Int64 => {
                let arr: Int64Array = rows
                    .iter()
                    .map(|row| {
                        src_idx.and_then(|i| row.get(i)).and_then(|v| match v {
                            QueryValue::Int(n) => Some(*n),
                            _ => None,
                        })
                    })
                    .collect();
                Arc::new(arr) as ArrayRef
            }
            DataType::Float64 => {
                let arr: Float64Array = rows
                    .iter()
                    .map(|row| {
                        src_idx.and_then(|i| row.get(i)).and_then(|v| match v {
                            QueryValue::Double(n) => Some(*n),
                            QueryValue::Int(n) => Some(*n as f64),
                            QueryValue::Text(s) | QueryValue::Decimal(s) => s.parse::<f64>().ok(),
                            _ => None,
                        })
                    })
                    .collect();
                Arc::new(arr) as ArrayRef
            }
            DataType::Binary => {
                let arr: BinaryArray = rows
                    .iter()
                    .map(|row| {
                        src_idx.and_then(|i| row.get(i)).and_then(|v| match v {
                            QueryValue::Data(d) => Some(d.as_slice()),
                            _ => None,
                        })
                    })
                    .collect();
                Arc::new(arr) as ArrayRef
            }
            _ => {
                // StringBuilder appends borrowed text straight into the array
                // buffer: no intermediate String per cell on the hot ingest path.
                let mut b = StringBuilder::new();
                for row in rows {
                    match src_idx.and_then(|i| row.get(i)) {
                        Some(QueryValue::Text(s))
                        | Some(QueryValue::Json(s))
                        | Some(QueryValue::Decimal(s)) => b.append_value(s),
                        Some(QueryValue::Int(n)) => b.append_value(n.to_string()),
                        Some(QueryValue::Double(n)) => b.append_value(n.to_string()),
                        Some(QueryValue::Bool(v)) => {
                            b.append_value(if *v { "true" } else { "false" })
                        }
                        _ => b.append_null(),
                    }
                }
                Arc::new(b.finish()) as ArrayRef
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use datafusion::arrow::array::Array;

    use super::*;

    fn col(name: &str, hint: &str) -> ColumnSpec {
        ColumnSpec::new(name, hint)
    }

    #[test]
    fn first_chunk_locks_the_schema() {
        let mut b = ArrowChunkBuilder::new(&[col("n", "int8"), col("s", "text")]);
        let batch = b
            .batch(&[vec![QueryValue::Int(1), QueryValue::Text("a".into())]])
            .unwrap();
        assert_eq!(batch.num_rows(), 1);
        let schema = batch.schema();
        assert_eq!(schema.field(0).data_type(), &DataType::Int64);
        assert_eq!(schema.field(1).data_type(), &DataType::Utf8);
    }

    #[test]
    fn later_chunks_coerce_to_the_locked_schema() {
        let mut b = ArrowChunkBuilder::new(&[col("n", "int8")]);
        b.batch(&[vec![QueryValue::Int(1)]]).unwrap();
        // A text value in a later chunk cannot become Int64: it nulls out
        // rather than silently drifting the schema.
        let batch = b.batch(&[vec![QueryValue::Text("boom".into())]]).unwrap();
        assert_eq!(batch.schema().field(0).data_type(), &DataType::Int64);
        assert!(batch.column(0).is_null(0));
    }

    #[test]
    fn numeric_type_hint_forces_float64() {
        let mut b = ArrowChunkBuilder::new(&[col("d", "numeric")]);
        let batch = b.batch(&[vec![QueryValue::Decimal("1.25".into())]]).unwrap();
        assert_eq!(batch.schema().field(0).data_type(), &DataType::Float64);
        let arr = batch
            .column(0)
            .as_any()
            .downcast_ref::<Float64Array>()
            .unwrap();
        assert_eq!(arr.value(0), 1.25);
    }

    #[test]
    fn all_null_first_chunk_falls_back_to_utf8() {
        let mut b = ArrowChunkBuilder::new(&[col("x", "unknown")]);
        let batch = b.batch(&[vec![QueryValue::Null]]).unwrap();
        assert_eq!(batch.schema().field(0).data_type(), &DataType::Utf8);
        assert!(batch.column(0).is_null(0));
    }

    #[test]
    fn zero_column_chunk_carries_the_row_count() {
        let mut b = ArrowChunkBuilder::new(&[]);
        let batch = b.batch(&[vec![], vec![], vec![]]).unwrap();
        assert_eq!(batch.num_rows(), 3);
        assert_eq!(batch.num_columns(), 0);
    }

    #[test]
    fn empty_chunk_produces_an_empty_batch() {
        let mut b = ArrowChunkBuilder::new(&[col("n", "int8")]);
        b.batch(&[vec![QueryValue::Int(1)]]).unwrap();
        let batch = b.batch(&[]).unwrap();
        assert_eq!(batch.num_rows(), 0);
        assert_eq!(batch.schema().field(0).data_type(), &DataType::Int64);
    }
}
