use mongodb::bson::{self, Bson, Document, doc};

use crate::{DriverError, QueryValue};
use crate::drivers::errors::Result;

pub(super) fn coerce_id(value: &QueryValue) -> Bson {
    match value {
        QueryValue::Null => Bson::Null,
        QueryValue::Bool(b) => Bson::Boolean(*b),
        QueryValue::Int(i) => Bson::Int64(*i),
        QueryValue::Double(d) => Bson::Double(*d),
        QueryValue::Text(s) => {
            // Treat 24-char hex strings as ObjectIds for parity with the Swift
            // CRUD path, which accepts hex strings in the editing UI.
            if s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit()) {
                if let Ok(oid) = bson::oid::ObjectId::parse_str(s) {
                    return Bson::ObjectId(oid);
                }
            }
            Bson::String(s.clone())
        }
        QueryValue::Data(b) => Bson::Binary(bson::Binary {
            subtype: bson::spec::BinarySubtype::Generic,
            bytes: b.clone(),
        }),
        QueryValue::Json(raw) => match serde_json::from_str::<serde_json::Value>(raw) {
            Ok(v) => bson::serialize_to_bson(&v).unwrap_or_else(|_| Bson::String(raw.clone())),
            Err(_) => Bson::String(raw.clone()),
        },
        QueryValue::Decimal(s) => Bson::String(s.clone()),
    }
}

/// Build a Mongo filter document from any (String, QueryValue) iterator.
/// Generic so IndexMap (from `update_row`, `RowDelete`, `RowEdit`) and any
/// other `(String, QueryValue)` iterators flow through the same path.
pub(super) fn primary_key_filter<'a, I>(pk: I) -> Result<Document>
where
    I: IntoIterator<Item = (&'a String, &'a QueryValue)>,
{
    let mut filter = Document::new();
    for (k, v) in pk {
        filter.insert(k.clone(), coerce_id(v));
    }
    if filter.is_empty() {
        return Err(DriverError::InvalidArgument(
            "primary key required for Mongo CRUD".into(),
        ));
    }
    Ok(filter)
}

pub(super) fn changes_to_set_doc<'a, I>(changes: I) -> Document
where
    I: IntoIterator<Item = (&'a String, &'a QueryValue)>,
{
    let mut set = Document::new();
    for (k, v) in changes {
        set.insert(k.clone(), coerce_id(v));
    }
    doc! { "$set": set }
}

pub(super) fn insert_doc_from<'a, I>(values: I) -> Document
where
    I: IntoIterator<Item = (&'a String, &'a QueryValue)>,
{
    let mut d = Document::new();
    for (k, v) in values {
        d.insert(k.clone(), coerce_id(v));
    }
    d
}

pub(super) fn json_to_doc(v: &serde_json::Value, what: &str) -> Result<Document> {
    let b = bson::serialize_to_bson(v)
        .map_err(|e| DriverError::InvalidArgument(format!("{what}: {e}")))?;
    match b {
        Bson::Document(d) => Ok(d),
        other => Err(DriverError::InvalidArgument(format!(
            "{what} must be a JSON object, got {other:?}"
        ))),
    }
}

pub(super) fn json_to_pipeline(v: &serde_json::Value) -> Result<Vec<Document>> {
    let arr = v
        .as_array()
        .ok_or_else(|| DriverError::InvalidArgument("aggregate pipeline must be a JSON array".into()))?;
    arr.iter()
        .enumerate()
        .map(|(i, stage)| json_to_doc(stage, &format!("aggregate stage {i}")))
        .collect()
}
