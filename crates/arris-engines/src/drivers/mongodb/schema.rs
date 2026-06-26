use futures_util::stream::StreamExt;
use indexmap::IndexMap;
use mongodb::bson::{Bson, Document};
use mongodb::results::{CollectionSpecification, CollectionType};
use mongodb::IndexModel;

use crate::{DriverError, SchemaNode, SchemaNodeKind};
use crate::drivers::errors::Result;

use super::tabular::bson_type_hint;

pub(super) fn fields_from_docs(docs: &[Document], coll_path: &str) -> Vec<SchemaNode> {
    let mut fields: IndexMap<String, &'static str> = IndexMap::new();
    let has_id = docs.iter().any(|d| d.contains_key("_id"));
    if has_id {
        fields.insert("_id".to_owned(), "ObjectId");
    }
    for doc in docs {
        for (k, v) in doc {
            if k == "_id" {
                continue;
            }
            fields
                .entry(k.clone())
                .or_insert_with(|| bson_type_hint(v));
        }
    }
    fields
        .into_iter()
        .map(|(name, type_hint)| {
            let path = format!("{coll_path}.{name}");
            SchemaNode::new(&name, SchemaNodeKind::Column, path).with_detail(type_hint)
        })
        .collect()
}

pub(super) fn collection_node_kind(spec: &CollectionSpecification) -> SchemaNodeKind {
    match spec.collection_type {
        CollectionType::View => SchemaNodeKind::View,
        CollectionType::Collection | CollectionType::Timeseries => SchemaNodeKind::Collection,
        _ => SchemaNodeKind::Collection,
    }
}

pub(super) fn collection_detail(spec: &CollectionSpecification) -> &'static str {
    match spec.collection_type {
        CollectionType::View => "view",
        CollectionType::Timeseries => "time-series",
        CollectionType::Collection if spec.options.capped == Some(true) => "capped",
        CollectionType::Collection => "regular",
        _ => "regular",
    }
}

pub(super) async fn index_nodes(
    coll: &mongodb::Collection<Document>,
    spec: &CollectionSpecification,
    coll_path: &str,
) -> Result<Vec<SchemaNode>> {
    if matches!(spec.collection_type, CollectionType::View) {
        return Ok(Vec::new());
    }

    let mut cursor = coll
        .list_indexes()
        .await
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    let mut indexes = Vec::new();
    while let Some(item) = cursor.next().await {
        indexes.push(item.map_err(|e| DriverError::QueryFailed(e.to_string()))?);
    }
    indexes.sort_by(|a, b| index_name(a).cmp(&index_name(b)));
    Ok(schema_index_nodes(indexes, coll_path))
}

pub(super) fn schema_index_nodes(indexes: Vec<IndexModel>, coll_path: &str) -> Vec<SchemaNode> {
    indexes
        .into_iter()
        .map(|index| {
            let name = index_name(&index);
            let path = format!("{coll_path}.__index__.{name}");
            SchemaNode::new(name, SchemaNodeKind::Index, path).with_detail(index_detail(&index))
        })
        .collect()
}

fn index_name(index: &IndexModel) -> String {
    index
        .options
        .as_ref()
        .and_then(|o| o.name.clone())
        .unwrap_or_else(|| format_index_keys(&index.keys))
}

fn index_detail(index: &IndexModel) -> String {
    let mut parts = vec![format!("index on {}", format_index_key_directions(&index.keys))];
    if let Some(options) = &index.options {
        if options.unique == Some(true) {
            parts.push("unique".to_owned());
        }
        if options.sparse == Some(true) {
            parts.push("sparse".to_owned());
        }
        if let Some(expire_after) = options.expire_after {
            parts.push(format!("ttl {}s", expire_after.as_secs()));
        }
    }
    parts.join(" \u{00b7} ")
}

fn format_index_key_directions(keys: &Document) -> String {
    keys.iter()
        .map(|(field, order)| format!("{field} {}", format_index_order(order)))
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_index_order(order: &Bson) -> String {
    match order {
        Bson::Int32(1) | Bson::Int64(1) => "asc".to_owned(),
        Bson::Int32(-1) | Bson::Int64(-1) => "desc".to_owned(),
        Bson::Double(v) if (*v - 1.0).abs() < f64::EPSILON => "asc".to_owned(),
        Bson::Double(v) if (*v + 1.0).abs() < f64::EPSILON => "desc".to_owned(),
        Bson::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn format_index_keys(keys: &Document) -> String {
    keys.iter()
        .map(|(field, order)| format!("{field}: {order}"))
        .collect::<Vec<_>>()
        .join(", ")
}
