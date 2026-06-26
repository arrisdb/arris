use std::collections::BTreeMap;

use serde_json::Value;

use crate::{SchemaNode, SchemaNodeKind};

const ES_ROOT_PATH: &str = "elasticsearch";

pub(super) fn schema_path(category: &str, name: &str) -> String {
    format!("{ES_ROOT_PATH}.{category}.{name}")
}

pub(super) fn field_nodes_from_mapping(target_path: &str, mapping: &Value) -> Vec<SchemaNode> {
    let Some(obj) = mapping.as_object() else {
        return Vec::new();
    };

    let properties = obj
        .values()
        .find_map(|entry| entry["mappings"]["properties"].as_object());
    let Some(properties) = properties else {
        return Vec::new();
    };

    field_nodes_from_properties(target_path, properties)
}

fn field_nodes_from_properties(
    parent_path: &str,
    properties: &serde_json::Map<String, Value>,
) -> Vec<SchemaNode> {
    let mut nodes = Vec::new();
    for (field_name, field_def) in properties {
        let field_path = format!("{parent_path}.{field_name}");
        let mut children = Vec::new();

        if let Some(props) = field_def["properties"].as_object() {
            children.extend(field_nodes_from_properties(&field_path, props));
        }
        if let Some(fields) = field_def["fields"].as_object() {
            children.extend(field_nodes_from_properties(&field_path, fields));
        }
        children.sort_by(|a, b| a.name.cmp(&b.name));

        let field_type = field_def["type"].as_str().unwrap_or("object");
        let mut node =
            SchemaNode::new(field_name, SchemaNodeKind::Column, field_path).with_detail(field_type);
        if !children.is_empty() {
            node = node.with_children(children);
        }
        nodes.push(node);
    }
    nodes.sort_by(|a, b| a.name.cmp(&b.name));
    nodes
}

pub(super) fn alias_nodes(alias_response: &Value) -> Vec<SchemaNode> {
    let mut aliases: BTreeMap<String, Vec<String>> = BTreeMap::new();
    if let Value::Object(indices) = alias_response {
        for (index_name, index_def) in indices {
            if let Some(alias_map) = index_def["aliases"].as_object() {
                for alias_name in alias_map.keys() {
                    aliases
                        .entry(alias_name.clone())
                        .or_default()
                        .push(index_name.clone());
                }
            }
        }
    }

    aliases
        .into_iter()
        .map(|(alias_name, mut indices)| {
            indices.sort();
            SchemaNode::new(
                &alias_name,
                SchemaNodeKind::ElasticsearchAlias,
                schema_path("aliases", &alias_name),
            )
            .with_detail(format!("alias -> {}", indices.join(", ")))
        })
        .collect()
}

pub(super) fn index_template_nodes(template_response: &Value) -> Vec<SchemaNode> {
    let templates = template_response["index_templates"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);

    let mut nodes: Vec<SchemaNode> = templates
        .iter()
        .filter_map(|template| {
            let name = template["name"].as_str()?;
            let template_def = &template["index_template"];
            let patterns = template_def["index_patterns"]
                .as_array()
                .map(|vals| {
                    vals.iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "no patterns".to_string());
            let children = field_nodes_from_mapping(
                &schema_path("templates", name),
                &serde_json::json!({
                    name: {
                        "mappings": template_def["template"]["mappings"].clone()
                    }
                }),
            );
            Some(
                SchemaNode::new(
                    name,
                    SchemaNodeKind::ElasticsearchIndexTemplate,
                    schema_path("templates", name),
                )
                .with_detail(patterns)
                .with_children(children),
            )
        })
        .collect();
    nodes.sort_by(|a, b| a.name.cmp(&b.name));
    nodes
}

pub(super) fn data_stream_nodes(data_stream_response: &Value) -> Vec<SchemaNode> {
    let streams = data_stream_response["data_streams"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);

    let mut nodes: Vec<SchemaNode> = streams
        .iter()
        .filter_map(|stream| {
            let name = stream["name"].as_str()?;
            let status = stream["status"].as_str().unwrap_or("unknown");
            let backing_count = stream["indices"].as_array().map(Vec::len).unwrap_or(0);
            Some(
                SchemaNode::new(
                    name,
                    SchemaNodeKind::ElasticsearchDataStream,
                    schema_path("dataStreams", name),
                )
                .with_detail(format!("{status} · {backing_count} backing indices")),
            )
        })
        .collect();
    nodes.sort_by(|a, b| a.name.cmp(&b.name));
    nodes
}
