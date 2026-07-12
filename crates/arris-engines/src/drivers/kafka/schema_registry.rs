use anyhow::{Context, Result};
use crate::{ColumnSpec, SchemaNode, SchemaNodeKind};
use serde::Deserialize;

#[derive(Clone)]
pub struct SchemaRegistryClient {
    base_url: String,
    client: reqwest::Client,
}

#[derive(Deserialize)]
struct SchemaResponse {
    schema: String,
}

#[derive(Deserialize)]
struct AvroSchema {
    #[serde(default)]
    fields: Vec<AvroField>,
}

#[derive(Deserialize)]
struct AvroField {
    name: String,
    #[serde(rename = "type")]
    field_type: serde_json::Value,
}

impl SchemaRegistryClient {
    pub fn new(base_url: &str) -> Self {
        let base_url = base_url.trim_end_matches('/').to_string();
        Self {
            base_url,
            client: reqwest::Client::new(),
        }
    }

    pub async fn list_subjects(&self) -> Result<Vec<String>> {
        let url = format!("{}/subjects", self.base_url);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .context("Schema Registry: failed to list subjects")?;
        let subjects: Vec<String> = resp.json().await.context("Schema Registry: bad JSON")?;
        Ok(subjects)
    }

    pub async fn get_columns_for_subject(&self, subject: &str) -> Result<Vec<ColumnSpec>> {
        let url = format!("{}/subjects/{}/versions/latest", self.base_url, subject);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .context("Schema Registry: failed to get schema")?;

        if !resp.status().is_success() {
            return Ok(vec![fallback_value_column()]);
        }

        let schema_resp: SchemaResponse = resp.json().await.context("Schema Registry: bad response")?;
        parse_avro_columns(&schema_resp.schema)
    }

    pub async fn get_topic_schema_nodes(&self, topic: &str) -> Result<Vec<SchemaNode>> {
        let subject = format!("{topic}-value");
        let columns = self.get_columns_for_subject(&subject).await?;
        Ok(columns
            .into_iter()
            .map(|col| SchemaNode {
                name: col.name.clone(),
                kind: SchemaNodeKind::Column,
                path: format!("{topic}.{}", col.name),
                detail: Some(col.type_hint),
                children: vec![],
            })
            .collect())
    }
}

fn parse_avro_columns(schema_json: &str) -> Result<Vec<ColumnSpec>> {
    let schema: AvroSchema =
        serde_json::from_str(schema_json).context("Failed to parse Avro schema")?;

    if schema.fields.is_empty() {
        return Ok(vec![fallback_value_column()]);
    }

    Ok(schema
        .fields
        .iter()
        .map(|f| {
            let type_hint = avro_type_to_hint(&f.field_type);
            ColumnSpec {
                name: f.name.clone(),
                type_hint,
            }
        })
        .collect())
}

fn avro_type_to_hint(val: &serde_json::Value) -> String {
    match val {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => {
            let non_null: Vec<&serde_json::Value> = arr
                .iter()
                .filter(|v| v.as_str() != Some("null"))
                .collect();
            if non_null.len() == 1 {
                avro_type_to_hint(non_null[0])
            } else {
                format!(
                    "union({})",
                    arr.iter()
                        .map(|v| avro_type_to_hint(v))
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            }
        }
        serde_json::Value::Object(obj) => {
            if let Some(t) = obj.get("type").and_then(|v| v.as_str()) {
                t.to_string()
            } else {
                "record".to_string()
            }
        }
        _ => "unknown".to_string(),
    }
}

fn fallback_value_column() -> ColumnSpec {
    ColumnSpec {
        name: "value".to_string(),
        type_hint: "bytes".to_string(),
    }
}

pub fn columns_from_json_sample(sample: &serde_json::Value) -> Vec<ColumnSpec> {
    match sample {
        serde_json::Value::Object(map) => map
            .iter()
            .map(|(k, v)| ColumnSpec {
                name: k.clone(),
                type_hint: json_value_type(v),
            })
            .collect(),
        _ => vec![fallback_value_column()],
    }
}

/// Column union over sampled rows: first-seen field order, and a null hint gets
/// upgraded to the first concrete type seen for that field.
pub fn columns_from_rows(rows: &[serde_json::Value]) -> Vec<ColumnSpec> {
    let mut union: indexmap::IndexMap<String, ColumnSpec> = indexmap::IndexMap::new();
    for row in rows {
        for col in columns_from_json_sample(row) {
            union
                .entry(col.name.clone())
                .and_modify(|existing| {
                    if existing.type_hint == "null" && col.type_hint != "null" {
                        existing.type_hint = col.type_hint.clone();
                    }
                })
                .or_insert(col);
        }
    }
    union.into_values().collect()
}

fn json_value_type(val: &serde_json::Value) -> String {
    match val {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(_) => "boolean".to_string(),
        serde_json::Value::Number(n) => {
            if n.is_f64() {
                "double".to_string()
            } else {
                "long".to_string()
            }
        }
        serde_json::Value::String(_) => "string".to_string(),
        serde_json::Value::Array(_) => "array".to_string(),
        serde_json::Value::Object(_) => "record".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_avro_simple_fields() {
        let schema = r#"{
            "type": "record",
            "name": "User",
            "fields": [
                {"name": "id", "type": "long"},
                {"name": "name", "type": "string"},
                {"name": "email", "type": ["null", "string"]}
            ]
        }"#;
        let cols = parse_avro_columns(schema).unwrap();
        assert_eq!(cols.len(), 3);
        assert_eq!(cols[0].name, "id");
        assert_eq!(cols[0].type_hint, "long");
        assert_eq!(cols[1].name, "name");
        assert_eq!(cols[1].type_hint, "string");
        assert_eq!(cols[2].name, "email");
        assert_eq!(cols[2].type_hint, "string");
    }

    #[test]
    fn parse_avro_empty_fallback() {
        let schema = r#"{"type": "string"}"#;
        let cols = parse_avro_columns(schema).unwrap();
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].name, "value");
    }

    #[test]
    fn parse_avro_nested_type() {
        let schema = r#"{
            "type": "record",
            "name": "Event",
            "fields": [
                {"name": "data", "type": {"type": "map", "values": "string"}}
            ]
        }"#;
        let cols = parse_avro_columns(schema).unwrap();
        assert_eq!(cols[0].type_hint, "map");
    }

    #[test]
    fn columns_from_json_sample_object() {
        let sample = serde_json::json!({"id": 1, "name": "alice", "active": true});
        let cols = columns_from_json_sample(&sample);
        assert_eq!(cols.len(), 3);
        let names: Vec<&str> = cols.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"id"));
        assert!(names.contains(&"name"));
        assert!(names.contains(&"active"));
    }

    #[test]
    fn columns_from_json_sample_non_object() {
        let sample = serde_json::json!("hello");
        let cols = columns_from_json_sample(&sample);
        assert_eq!(cols.len(), 1);
        assert_eq!(cols[0].name, "value");
    }

    #[test]
    fn avro_union_type_hint() {
        let val = serde_json::json!(["null", "string", "int"]);
        let hint = avro_type_to_hint(&val);
        assert_eq!(hint, "union(null, string, int)");
    }
}
