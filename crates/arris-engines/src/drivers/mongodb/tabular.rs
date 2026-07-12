//! BSON document flattening — turns a stream of result documents into a
//! `QueryResult` with one column per top-level field. `_id` is always the
//! first column (mirrors the Swift `MongoBSON.flattenTopLevel +
//! MongoDriver.tabularize` pair).

use std::collections::HashMap;

use indexmap::IndexMap;
use mongodb::bson::{Bson, Document, RawBsonRef, RawDocument};

use crate::{ColumnSpec, QueryResult, QueryValue};

/// Fold one document's top-level fields into the running column union,
/// preserving first-seen order (`_id` is reordered to the front by
/// [`finalize_columns`]).
pub(super) fn accumulate_columns(columns: &mut IndexMap<String, ColumnSpec>, doc: &Document) {
    for (k, v) in doc {
        columns
            .entry(k.clone())
            .or_insert_with(|| ColumnSpec::new(k, bson_type_hint(v)));
    }
}

/// Freeze the accumulated union into column order: `_id` first (typed as
/// `ObjectId` to match Mongo's implicit PK), then the rest in first-seen order.
pub(super) fn finalize_columns(columns: IndexMap<String, ColumnSpec>) -> Vec<ColumnSpec> {
    let mut out = Vec::with_capacity(columns.len());
    if columns.contains_key("_id") {
        out.push(ColumnSpec::new("_id", "ObjectId"));
    }
    out.extend(columns.into_iter().filter(|(k, _)| k != "_id").map(|(_, v)| v));
    out
}

/// Map each column name to its row position, for O(fields) projection.
pub(super) fn column_index(columns: &[ColumnSpec]) -> HashMap<String, usize> {
    columns
        .iter()
        .enumerate()
        .map(|(i, c)| (c.name.clone(), i))
        .collect()
}

/// Project one document onto the fixed columns in a single pass over its fields
/// (absent columns stay `Null`), instead of a per-column lookup.
pub(super) fn project_row(
    doc: &Document,
    index: &HashMap<String, usize>,
    width: usize,
) -> Vec<QueryValue> {
    let mut row = vec![QueryValue::Null; width];
    for (k, v) in doc {
        if let Some(&i) = index.get(k.as_str()) {
            row[i] = bson_to_value(v);
        }
    }
    row
}

/// Build a `QueryResult` from MongoDB documents. Top-level fields become
/// columns (union across docs, `_id` first) and each cell is rendered as
/// the closest `QueryValue` variant. Nested objects/arrays are encoded as
/// extended-JSON strings so the grid can render them as `Json`.
pub fn tabularize(docs: &[Document]) -> QueryResult {
    let mut columns: IndexMap<String, ColumnSpec> = IndexMap::new();
    for doc in docs {
        accumulate_columns(&mut columns, doc);
    }
    let columns = finalize_columns(columns);
    let index = column_index(&columns);
    let width = columns.len();
    let rows = docs.iter().map(|doc| project_row(doc, &index, width)).collect();

    QueryResult {
        columns,
        rows,
        rows_affected: None,
        elapsed: 0.0,
        ..Default::default()
    }
}

pub fn bson_type_hint(v: &Bson) -> &'static str {
    match v {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Array(_) => "array",
        Bson::Document(_) => "object",
        Bson::Boolean(_) => "bool",
        Bson::Null => "null",
        Bson::RegularExpression(_) => "regex",
        Bson::JavaScriptCode(_) | Bson::JavaScriptCodeWithScope(_) => "javascript",
        Bson::Int32(_) => "int32",
        Bson::Int64(_) => "int64",
        Bson::Timestamp(_) => "timestamp",
        Bson::Binary(_) => "binary",
        Bson::ObjectId(_) => "ObjectId",
        Bson::DateTime(_) => "date",
        Bson::Symbol(_) => "symbol",
        Bson::Decimal128(_) => "decimal",
        Bson::Undefined => "undefined",
        Bson::MaxKey => "maxKey",
        Bson::MinKey => "minKey",
        Bson::DbPointer(_) => "dbPointer",
    }
}

pub fn bson_to_value(v: &Bson) -> QueryValue {
    match v {
        Bson::Null | Bson::Undefined => QueryValue::Null,
        Bson::Boolean(b) => QueryValue::Bool(*b),
        Bson::Int32(n) => QueryValue::Int(i64::from(*n)),
        Bson::Int64(n) => QueryValue::Int(*n),
        Bson::Double(f) => QueryValue::Double(*f),
        Bson::String(s) => QueryValue::Text(s.clone()),
        Bson::ObjectId(oid) => QueryValue::Text(oid.to_hex()),
        Bson::DateTime(dt) => QueryValue::Text(dt.try_to_rfc3339_string().unwrap_or_else(|_| dt.to_string())),
        Bson::Binary(b) => QueryValue::Data(b.bytes.clone()),
        Bson::Decimal128(d) => QueryValue::Text(d.to_string()),
        Bson::Symbol(s) => QueryValue::Text(s.clone()),
        Bson::RegularExpression(r) => QueryValue::Text(format!("/{}/{}", r.pattern, r.options)),
        Bson::Document(_) | Bson::Array(_) => {
            // Serialize via serde — bson::Bson's Serialize impl emits relaxed
            // extended JSON. Good enough for the grid's `Json` cell type.
            QueryValue::Json(serde_json::to_string(v).unwrap_or_default())
        }
        Bson::JavaScriptCode(c) => QueryValue::Text(c.clone()),
        Bson::JavaScriptCodeWithScope(c) => QueryValue::Text(c.code.clone()),
        Bson::Timestamp(t) => QueryValue::Text(format!("Timestamp({}, {})", t.time, t.increment)),
        Bson::MaxKey => QueryValue::Text("MaxKey".into()),
        Bson::MinKey => QueryValue::Text("MinKey".into()),
        Bson::DbPointer(_) => QueryValue::Text("DBPointer".into()),
    }
}

// ── raw BSON (streaming) ────────────────────────────────────────────────────
// Streaming fetches `RawDocumentBuf` and converts field refs straight to
// `QueryValue`, skipping the ~4x-costlier `Document` (per-field String/Bson) alloc.

fn raw_type_hint(v: RawBsonRef) -> &'static str {
    match v {
        RawBsonRef::Double(_) => "double",
        RawBsonRef::String(_) => "string",
        RawBsonRef::Array(_) => "array",
        RawBsonRef::Document(_) => "object",
        RawBsonRef::Boolean(_) => "bool",
        RawBsonRef::Null => "null",
        RawBsonRef::RegularExpression(_) => "regex",
        RawBsonRef::JavaScriptCode(_) | RawBsonRef::JavaScriptCodeWithScope(_) => "javascript",
        RawBsonRef::Int32(_) => "int32",
        RawBsonRef::Int64(_) => "int64",
        RawBsonRef::Timestamp(_) => "timestamp",
        RawBsonRef::Binary(_) => "binary",
        RawBsonRef::ObjectId(_) => "ObjectId",
        RawBsonRef::DateTime(_) => "date",
        RawBsonRef::Symbol(_) => "symbol",
        RawBsonRef::Decimal128(_) => "decimal",
        RawBsonRef::Undefined => "undefined",
        RawBsonRef::MaxKey => "maxKey",
        RawBsonRef::MinKey => "minKey",
        RawBsonRef::DbPointer(_) => "dbPointer",
    }
}

fn raw_to_value(v: RawBsonRef) -> QueryValue {
    match v {
        RawBsonRef::Null | RawBsonRef::Undefined => QueryValue::Null,
        RawBsonRef::Boolean(b) => QueryValue::Bool(b),
        RawBsonRef::Int32(n) => QueryValue::Int(i64::from(n)),
        RawBsonRef::Int64(n) => QueryValue::Int(n),
        RawBsonRef::Double(f) => QueryValue::Double(f),
        RawBsonRef::String(s) => QueryValue::Text(s.to_owned()),
        RawBsonRef::ObjectId(oid) => QueryValue::Text(oid.to_hex()),
        RawBsonRef::DateTime(dt) => {
            QueryValue::Text(dt.try_to_rfc3339_string().unwrap_or_else(|_| dt.to_string()))
        }
        RawBsonRef::Binary(b) => QueryValue::Data(b.bytes.to_vec()),
        RawBsonRef::Decimal128(d) => QueryValue::Text(d.to_string()),
        RawBsonRef::Symbol(s) => QueryValue::Text(s.to_owned()),
        RawBsonRef::JavaScriptCode(c) => QueryValue::Text(c.to_owned()),
        RawBsonRef::Timestamp(t) => QueryValue::Text(format!("Timestamp({}, {})", t.time, t.increment)),
        RawBsonRef::MaxKey => QueryValue::Text("MaxKey".into()),
        RawBsonRef::MinKey => QueryValue::Text("MinKey".into()),
        // Nested docs/arrays/regex/etc. are rare: own them and reuse the Bson path.
        other => Bson::try_from(other).map_or(QueryValue::Null, |b| bson_to_value(&b)),
    }
}

/// Fold a raw document's top-level fields into the running column union
/// (malformed fields skipped). Raw counterpart of [`accumulate_columns`].
pub(super) fn accumulate_columns_raw(columns: &mut IndexMap<String, ColumnSpec>, doc: &RawDocument) {
    for (k, v) in doc.iter().flatten() {
        let k = k.as_str();
        columns
            .entry(k.to_owned())
            .or_insert_with(|| ColumnSpec::new(k, raw_type_hint(v)));
    }
}

/// Project a raw document onto the fixed columns in one pass. Raw counterpart of
/// [`project_row`].
pub(super) fn project_row_raw(
    doc: &RawDocument,
    index: &HashMap<String, usize>,
    width: usize,
) -> Vec<QueryValue> {
    let mut row = vec![QueryValue::Null; width];
    for (k, v) in doc.iter().flatten() {
        if let Some(&i) = index.get(k.as_str()) {
            row[i] = raw_to_value(v);
        }
    }
    row
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{Bson, doc, oid::ObjectId};

    #[test]
    fn empty_input_yields_empty_result() {
        let r = tabularize(&[]);
        assert!(r.columns.is_empty());
        assert!(r.rows.is_empty());
    }

    #[test]
    fn id_first_then_other_fields_in_first_seen_order() {
        let oid = ObjectId::new();
        let docs = vec![
            doc! { "_id": oid, "name": "alice", "age": 30 },
            doc! { "_id": oid, "age": 31, "city": "NYC" },
        ];
        let r = tabularize(&docs);
        let names: Vec<&str> = r.columns.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["_id", "name", "age", "city"]);
    }

    #[test]
    fn missing_field_produces_null_cell() {
        let docs = vec![doc! { "a": 1 }, doc! { "b": 2 }];
        let r = tabularize(&docs);
        // Row 0: a=1, b=null. Row 1: a=null, b=2.
        assert_eq!(r.rows[0][0], QueryValue::Int(1));
        assert_eq!(r.rows[0][1], QueryValue::Null);
        assert_eq!(r.rows[1][0], QueryValue::Null);
        assert_eq!(r.rows[1][1], QueryValue::Int(2));
    }

    #[test]
    fn nested_documents_become_json_values() {
        let docs = vec![doc! { "x": doc! { "y": 1 } }];
        let r = tabularize(&docs);
        match &r.rows[0][0] {
            QueryValue::Json(s) => assert!(s.contains("\"y\""), "got {s}"),
            other => panic!("expected json, got {other:?}"),
        }
    }

    #[test]
    fn objectid_renders_as_hex_text() {
        let oid = ObjectId::parse_str("507f1f77bcf86cd799439011").unwrap();
        let docs = vec![doc! { "_id": oid }];
        let r = tabularize(&docs);
        assert_eq!(
            r.rows[0][0],
            QueryValue::Text("507f1f77bcf86cd799439011".into())
        );
    }

    #[test]
    fn accumulate_then_finalize_unions_disjoint_docs_with_id_first() {
        // A field appearing only in a later doc still earns a column: this is
        // the completeness guarantee the streaming pass-1 scan relies on.
        let mut cols = IndexMap::new();
        accumulate_columns(&mut cols, &doc! { "a": 1, "b": 2 });
        accumulate_columns(&mut cols, &doc! { "_id": 9, "c": 3 });
        let names: Vec<String> = finalize_columns(cols).into_iter().map(|c| c.name).collect();
        assert_eq!(names, vec!["_id", "a", "b", "c"]);
    }

    #[test]
    fn project_row_places_fields_by_index_with_nulls() {
        let cols = vec![
            ColumnSpec::new("_id", "ObjectId"),
            ColumnSpec::new("a", "int32"),
            ColumnSpec::new("b", "int32"),
        ];
        let index = column_index(&cols);
        let row = project_row(&doc! { "_id": 1, "b": 5 }, &index, cols.len());
        assert_eq!(row, vec![QueryValue::Int(1), QueryValue::Null, QueryValue::Int(5)]);
    }

    #[test]
    fn primitive_kinds_map_to_query_value() {
        assert_eq!(bson_to_value(&Bson::Null), QueryValue::Null);
        assert_eq!(bson_to_value(&Bson::Boolean(true)), QueryValue::Bool(true));
        assert_eq!(bson_to_value(&Bson::Int32(7)), QueryValue::Int(7));
        assert_eq!(bson_to_value(&Bson::Int64(7)), QueryValue::Int(7));
        assert_eq!(bson_to_value(&Bson::Double(1.5)), QueryValue::Double(1.5));
        assert_eq!(
            bson_to_value(&Bson::String("hi".into())),
            QueryValue::Text("hi".into())
        );
    }
}
