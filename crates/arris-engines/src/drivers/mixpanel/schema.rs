use std::collections::BTreeMap;

use crate::{SchemaNode, SchemaNodeKind};

use super::constants::{EVENTS_TABLE, MP_ROOT_NAME, MP_ROOT_PATH};

// Mixpanel exposes a single logical table, `events`, which every query targets
// (`FROM events`). Each discovered event property becomes a column on it, and the
// base columns event/time/distinct_id are always queryable.
pub(super) fn build_schema_tree(
    discovered: &BTreeMap<String, BTreeMap<String, String>>,
) -> Vec<SchemaNode> {
    let table_path = format!("{MP_ROOT_PATH}.{EVENTS_TABLE}");

    // Union every event's properties into one column set. BTreeMap keeps the
    // columns alphabetically ordered and de-duplicated across events.
    let mut columns: BTreeMap<String, String> = BTreeMap::new();
    for base in ["event", "time", "distinct_id"] {
        columns.insert(base.to_owned(), String::new());
    }
    for properties in discovered.values() {
        for (prop_name, prop_type) in properties {
            columns
                .entry(prop_name.clone())
                .or_insert_with(|| prop_type.clone());
        }
    }

    let column_nodes: Vec<SchemaNode> = columns
        .iter()
        .map(|(name, ty)| {
            let mut node =
                SchemaNode::new(name, SchemaNodeKind::Column, format!("{table_path}.{name}"));
            if !ty.is_empty() {
                node = node.with_detail(ty);
            }
            node
        })
        .collect();

    let events_table = SchemaNode::new(EVENTS_TABLE, SchemaNodeKind::Table, table_path)
        .with_children(column_nodes);

    vec![
        SchemaNode::new(MP_ROOT_NAME, SchemaNodeKind::Database, MP_ROOT_PATH)
            .with_children(vec![events_table]),
    ]
}
