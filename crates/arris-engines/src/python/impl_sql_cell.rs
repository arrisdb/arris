use base64::Engine as _;
use datafusion::arrow::array::{
    ArrayRef, BinaryArray, BooleanArray, Float64Array, Int64Array, StringArray,
};
use datafusion::arrow::datatypes::{DataType, Field, Schema};
use datafusion::arrow::ipc::writer::StreamWriter;
use datafusion::arrow::record_batch::RecordBatch;
use std::sync::Arc;

use crate::{QueryResult, QueryValue};

use super::errors::SqlCellError;

/// The arrow logical type chosen for one result column. A column adopts the
/// type of its first non-null value; any column whose non-null values disagree
/// (or that has none) falls back to `Utf8` so nothing is lost.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ColumnKind {
    Bool,
    Int,
    Double,
    Utf8,
    Binary,
}

/// Builds the Python snippet that binds a SQL result into a kernel as a pandas
/// DataFrame. The result is serialized to an Arrow IPC stream, base64-encoded,
/// and embedded in a tiny `execute_request`; the kernel decodes it in memory
/// (no temp files) via `pyarrow` and `.to_pandas()`.
pub(super) struct SqlCell;

impl SqlCell {
    /// Validate `var_name`, serialize `result` to Arrow IPC, and return the
    /// Python snippet that reconstructs the DataFrame and previews it.
    pub(super) fn bind_snippet(
        result: &QueryResult,
        var_name: &str,
    ) -> Result<String, SqlCellError> {
        if !Self::is_valid_identifier(var_name) {
            return Err(SqlCellError::InvalidIdentifier(var_name.to_string()));
        }
        let ipc = Self::to_arrow_ipc(result)?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&ipc);
        Ok(Self::render_snippet(var_name, &b64))
    }

    /// A valid, non-keyword Python identifier (so the kernel assignment is safe
    /// and the base64 blob can never break out of the generated code).
    fn is_valid_identifier(name: &str) -> bool {
        let mut chars = name.chars();
        let first_ok = matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '_');
        if !first_ok {
            return false;
        }
        if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return false;
        }
        !Self::is_python_keyword(name)
    }

    fn is_python_keyword(name: &str) -> bool {
        const KEYWORDS: &[&str] = &[
            "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class",
            "continue", "def", "del", "elif", "else", "except", "finally", "for", "from", "global",
            "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
            "return", "try", "while", "with", "yield",
        ];
        KEYWORDS.contains(&name)
    }

    /// Serialize a `QueryResult` to an Arrow IPC stream. One array per column,
    /// typed by `column_kind`, nulls preserved.
    fn to_arrow_ipc(result: &QueryResult) -> Result<Vec<u8>, SqlCellError> {
        let fields: Vec<Field> = result
            .columns
            .iter()
            .enumerate()
            .map(|(c, spec)| {
                let kind = Self::column_kind(result, c);
                Field::new(&spec.name, Self::arrow_type(kind), true)
            })
            .collect();
        let schema = Arc::new(Schema::new(fields));

        let arrays: Vec<ArrayRef> = result
            .columns
            .iter()
            .enumerate()
            .map(|(c, _)| Self::build_array(result, c))
            .collect();

        // A result with rows but no columns (rare; e.g. a bare DDL ack) yields
        // an empty schema; `try_new` handles the zero-column batch fine.
        let batch = RecordBatch::try_new(schema.clone(), arrays)
            .map_err(|e| SqlCellError::Arrow(e.to_string()))?;

        let mut buf = Vec::new();
        {
            let mut writer = StreamWriter::try_new(&mut buf, &schema)
                .map_err(|e| SqlCellError::Arrow(e.to_string()))?;
            writer
                .write(&batch)
                .map_err(|e| SqlCellError::Arrow(e.to_string()))?;
            writer
                .finish()
                .map_err(|e| SqlCellError::Arrow(e.to_string()))?;
        }
        Ok(buf)
    }

    /// Pick a column's arrow type from its first non-null value; disagreeing or
    /// all-null columns become `Utf8`.
    fn column_kind(result: &QueryResult, col: usize) -> ColumnKind {
        let mut chosen: Option<ColumnKind> = None;
        for row in &result.rows {
            let Some(value) = row.get(col) else { continue };
            if value.is_null() {
                continue;
            }
            let kind = Self::value_kind(value);
            match chosen {
                None => chosen = Some(kind),
                Some(existing) if existing != kind => return ColumnKind::Utf8,
                _ => {}
            }
        }
        chosen.unwrap_or(ColumnKind::Utf8)
    }

    fn value_kind(value: &QueryValue) -> ColumnKind {
        match value {
            QueryValue::Bool(_) => ColumnKind::Bool,
            QueryValue::Int(_) => ColumnKind::Int,
            QueryValue::Double(_) => ColumnKind::Double,
            QueryValue::Data(_) => ColumnKind::Binary,
            // Text/Json/Decimal all carry strings; Decimal stays a string so its
            // precision survives the trip into pandas.
            QueryValue::Text(_) | QueryValue::Json(_) | QueryValue::Decimal(_) => ColumnKind::Utf8,
            QueryValue::Null => ColumnKind::Utf8,
        }
    }

    fn arrow_type(kind: ColumnKind) -> DataType {
        match kind {
            ColumnKind::Bool => DataType::Boolean,
            ColumnKind::Int => DataType::Int64,
            ColumnKind::Double => DataType::Float64,
            ColumnKind::Utf8 => DataType::Utf8,
            ColumnKind::Binary => DataType::Binary,
        }
    }

    fn build_array(result: &QueryResult, col: usize) -> ArrayRef {
        let cell = |row: &[QueryValue]| row.get(col).unwrap_or(&QueryValue::Null).clone();
        match Self::column_kind(result, col) {
            ColumnKind::Bool => {
                let it = result.rows.iter().map(|r| match cell(r) {
                    QueryValue::Bool(b) => Some(b),
                    _ => None,
                });
                Arc::new(it.collect::<BooleanArray>())
            }
            ColumnKind::Int => {
                let it = result.rows.iter().map(|r| match cell(r) {
                    QueryValue::Int(v) => Some(v),
                    _ => None,
                });
                Arc::new(it.collect::<Int64Array>())
            }
            ColumnKind::Double => {
                let it = result.rows.iter().map(|r| match cell(r) {
                    QueryValue::Double(v) => Some(v),
                    _ => None,
                });
                Arc::new(it.collect::<Float64Array>())
            }
            ColumnKind::Binary => {
                let owned: Vec<Option<Vec<u8>>> = result
                    .rows
                    .iter()
                    .map(|r| match cell(r) {
                        QueryValue::Data(d) => Some(d),
                        _ => None,
                    })
                    .collect();
                Arc::new(BinaryArray::from_iter(
                    owned.iter().map(|o| o.as_deref()),
                ))
            }
            ColumnKind::Utf8 => {
                let owned: Vec<Option<String>> = result
                    .rows
                    .iter()
                    .map(|r| {
                        let v = cell(r);
                        if v.is_null() {
                            None
                        } else {
                            Some(Self::value_to_string(&v))
                        }
                    })
                    .collect();
                Arc::new(StringArray::from_iter(owned.iter().map(|o| o.as_deref())))
            }
        }
    }

    /// The natural string for a `Utf8` column cell — the literal text for
    /// string-like values, `display_string` for anything coerced in.
    fn value_to_string(value: &QueryValue) -> String {
        match value {
            QueryValue::Text(s) | QueryValue::Json(s) | QueryValue::Decimal(s) => s.clone(),
            other => other.display_string(),
        }
    }

    fn render_snippet(var_name: &str, b64: &str) -> String {
        // Imports use leading-underscore aliases and are deleted afterwards so
        // the cell leaves only the bound DataFrame in the namespace. A missing
        // `pyarrow`/`pandas` surfaces here as a normal kernel ImportError.
        format!(
            "import base64 as _arris_b64, io as _arris_io, pyarrow as _arris_pa\n\
             _arris_buf = _arris_b64.b64decode(\"{b64}\")\n\
             {var} = _arris_pa.ipc.open_stream(_arris_io.BytesIO(_arris_buf)).read_all().to_pandas()\n\
             del _arris_buf, _arris_b64, _arris_io, _arris_pa\n\
             try:\n\
             \u{20}\u{20}\u{20}\u{20}from IPython.display import display as _arris_display, HTML as _arris_HTML\n\
             \u{20}\u{20}\u{20}\u{20}_arris_display(_arris_HTML({var}.head(50).to_html()))\n\
             \u{20}\u{20}\u{20}\u{20}del _arris_display, _arris_HTML\n\
             except Exception:\n\
             \u{20}\u{20}\u{20}\u{20}pass\n\
             print(\"bound `{var}`: %d rows, %d cols\" % ({var}.shape[0], {var}.shape[1]))\n",
            b64 = b64,
            var = var_name,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ColumnSpec;
    use datafusion::arrow::array::{Array, AsArray};
    use datafusion::arrow::datatypes::{Float64Type, Int64Type};
    use datafusion::arrow::ipc::reader::StreamReader;

    fn result(columns: &[&str], rows: Vec<Vec<QueryValue>>) -> QueryResult {
        QueryResult::new(
            columns
                .iter()
                .map(|c| ColumnSpec::new(*c, "text"))
                .collect(),
            rows,
        )
    }

    /// Decode the IPC bytes back into a single RecordBatch for assertions.
    fn read_back(result: &QueryResult) -> RecordBatch {
        let ipc = SqlCell::to_arrow_ipc(result).unwrap();
        let mut reader = StreamReader::try_new(std::io::Cursor::new(ipc), None).unwrap();
        reader.next().unwrap().unwrap()
    }

    #[test]
    fn rejects_invalid_identifiers() {
        assert!(!SqlCell::is_valid_identifier(""));
        assert!(!SqlCell::is_valid_identifier("1df"));
        assert!(!SqlCell::is_valid_identifier("my df"));
        assert!(!SqlCell::is_valid_identifier("df-1"));
        assert!(!SqlCell::is_valid_identifier("import"));
        assert!(!SqlCell::is_valid_identifier("class"));
    }

    #[test]
    fn accepts_valid_identifiers() {
        assert!(SqlCell::is_valid_identifier("df"));
        assert!(SqlCell::is_valid_identifier("_df1"));
        assert!(SqlCell::is_valid_identifier("orders"));
        assert!(SqlCell::is_valid_identifier("Order2"));
    }

    #[test]
    fn bind_snippet_rejects_bad_var_name() {
        let r = result(&["a"], vec![vec![QueryValue::Int(1)]]);
        let err = SqlCell::bind_snippet(&r, "9bad").unwrap_err();
        assert!(matches!(err, SqlCellError::InvalidIdentifier(_)));
    }

    #[test]
    fn snippet_embeds_var_and_base64_and_no_disk() {
        let r = result(&["a"], vec![vec![QueryValue::Int(1)]]);
        let snippet = SqlCell::bind_snippet(&r, "orders").unwrap();
        assert!(snippet.contains("orders = _arris_pa.ipc.open_stream"));
        assert!(snippet.contains(".to_pandas()"));
        assert!(snippet.contains("bound `orders`: %d rows, %d cols"));
        // never touches the filesystem
        assert!(!snippet.contains("open("));
        assert!(!snippet.contains("read_feather"));
    }

    #[test]
    fn roundtrip_column_names_and_row_count() {
        let r = result(
            &["id", "name"],
            vec![
                vec![QueryValue::Int(1), QueryValue::Text("a".into())],
                vec![QueryValue::Int(2), QueryValue::Text("b".into())],
            ],
        );
        let batch = read_back(&r);
        assert_eq!(batch.num_rows(), 2);
        assert_eq!(batch.num_columns(), 2);
        assert_eq!(batch.schema().field(0).name(), "id");
        assert_eq!(batch.schema().field(1).name(), "name");
    }

    #[test]
    fn roundtrip_types_per_variant() {
        let r = result(
            &["i", "d", "b", "t", "j", "dec", "bin"],
            vec![vec![
                QueryValue::Int(7),
                QueryValue::Double(1.5),
                QueryValue::Bool(true),
                QueryValue::Text("hi".into()),
                QueryValue::Json("{\"k\":1}".into()),
                QueryValue::Decimal("129.00".into()),
                QueryValue::Data(vec![0xde, 0xad]),
            ]],
        );
        let batch = read_back(&r);
        let s = batch.schema();
        assert_eq!(s.field(0).data_type(), &DataType::Int64);
        assert_eq!(s.field(1).data_type(), &DataType::Float64);
        assert_eq!(s.field(2).data_type(), &DataType::Boolean);
        assert_eq!(s.field(3).data_type(), &DataType::Utf8);
        assert_eq!(s.field(4).data_type(), &DataType::Utf8);
        assert_eq!(s.field(5).data_type(), &DataType::Utf8);
        assert_eq!(s.field(6).data_type(), &DataType::Binary);

        // decimal preserved as its exact digit string
        let dec = batch.column(5).as_string::<i32>();
        assert_eq!(dec.value(0), "129.00");
        // int value intact
        let ints = batch.column(0).as_primitive::<Int64Type>();
        assert_eq!(ints.value(0), 7);
        let dbls = batch.column(1).as_primitive::<Float64Type>();
        assert_eq!(dbls.value(0), 1.5);
    }

    #[test]
    fn nulls_preserved_and_all_null_column_is_utf8() {
        let r = result(
            &["x", "empty"],
            vec![
                vec![QueryValue::Int(1), QueryValue::Null],
                vec![QueryValue::Null, QueryValue::Null],
            ],
        );
        let batch = read_back(&r);
        let xs = batch.column(0).as_primitive::<Int64Type>();
        assert!(!xs.is_null(0));
        assert!(xs.is_null(1));
        // a column with no non-null values defaults to a nullable Utf8 array
        assert_eq!(batch.schema().field(1).data_type(), &DataType::Utf8);
        assert!(batch.column(1).is_null(0));
        assert!(batch.column(1).is_null(1));
    }

    #[test]
    fn mixed_value_column_falls_back_to_utf8() {
        let r = result(
            &["mixed"],
            vec![
                vec![QueryValue::Int(1)],
                vec![QueryValue::Text("two".into())],
            ],
        );
        let batch = read_back(&r);
        assert_eq!(batch.schema().field(0).data_type(), &DataType::Utf8);
        let col = batch.column(0).as_string::<i32>();
        assert_eq!(col.value(0), "1");
        assert_eq!(col.value(1), "two");
    }
}
