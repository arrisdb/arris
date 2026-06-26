use std::collections::BTreeMap;

use crate::{SchemaNode, SchemaNodeKind};

use super::driver::{MP_ROOT_NAME, MP_ROOT_PATH};

pub(super) fn build_schema_tree(discovered: &BTreeMap<String, BTreeMap<String, String>>) -> Vec<SchemaNode> {
    let mut children: Vec<SchemaNode> = Vec::new();
    let mut all_properties: BTreeMap<String, String> = BTreeMap::new();

    for (event_name, properties) in discovered {
        let event_path = format!("{MP_ROOT_PATH}.events.{event_name}");
        let mut prop_children: Vec<SchemaNode> = properties
            .iter()
            .map(|(prop_name, prop_type)| {
                let mut node = SchemaNode::new(
                    prop_name,
                    SchemaNodeKind::Column,
                    format!("{event_path}.{prop_name}"),
                );
                if !prop_type.is_empty() {
                    node = node.with_detail(prop_type);
                }
                node
            })
            .collect();
        prop_children.sort_by(|a, b| a.name.cmp(&b.name));

        children.push(
            SchemaNode::new(event_name, SchemaNodeKind::MixpanelEvent, event_path)
                .with_children(prop_children),
        );

        for (k, v) in properties {
            all_properties.entry(k.clone()).or_insert_with(|| v.clone());
        }
    }

    for (prop_name, prop_type) in &all_properties {
        let mut node = SchemaNode::new(
            prop_name,
            SchemaNodeKind::MixpanelEventProperty,
            format!("{MP_ROOT_PATH}.properties.{prop_name}"),
        );
        if !prop_type.is_empty() {
            node = node.with_detail(prop_type);
        }
        children.push(node);
    }

    children.sort_by(|a, b| a.name.cmp(&b.name));

    vec![SchemaNode::new(MP_ROOT_NAME, SchemaNodeKind::Database, MP_ROOT_PATH)
        .with_children(children)]
}
