//! ClickHouse `EXPLAIN json = 1` plan-tree walker.
//!
//! `EXPLAIN json = 1, indexes = 1 <query>` returns a JSON array whose single
//! element wraps the root plan under `"Plan"`. Each node carries a `"Node Type"`
//! string, optional scalar fields (kept as [`PlanAttribute`]s), and child nodes
//! under `"Plans"`. [`walk_explain`] mirrors the Postgres walker so the frontend
//! renders ClickHouse plans the same way.

use serde_json::Value as Json;

use crate::{PlanAttribute, PlanNode};

/// Builds a [`PlanNode`] tree from parsed ClickHouse `EXPLAIN json = 1` output.
/// Accepts either the top-level array or a bare plan object.
pub(super) fn walk_explain(value: &Json) -> PlanNode {
    let plan = match value {
        Json::Array(items) => items
            .first()
            .and_then(|first| first.get("Plan"))
            .unwrap_or(value),
        other => other.get("Plan").unwrap_or(other),
    };
    walk_node(plan)
}

fn walk_node(node: &Json) -> PlanNode {
    let node_type = node
        .get("Node Type")
        .and_then(Json::as_str)
        .unwrap_or("Plan")
        .to_owned();

    let mut plan = PlanNode::new(node_type.clone(), node_type);

    if let Some(obj) = node.as_object() {
        for (key, val) in obj {
            if key == "Node Type" || key == "Plans" {
                continue;
            }
            match val {
                Json::String(s) => {
                    plan.attributes.push(PlanAttribute::new(key, s));
                }
                Json::Number(n) => {
                    plan.attributes.push(PlanAttribute::new(key, n.to_string()));
                }
                Json::Bool(b) => {
                    plan.attributes.push(PlanAttribute::new(key, b.to_string()));
                }
                // Arrays/objects (e.g. "Indexes") are summarised compactly.
                Json::Array(_) | Json::Object(_) => {
                    plan.attributes.push(PlanAttribute::new(key, val.to_string()));
                }
                Json::Null => {}
            }
        }
    }

    if let Some(children) = node.get("Plans").and_then(Json::as_array) {
        plan.children = children.iter().map(walk_node).collect();
    }

    plan
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walks_node_type_and_children() {
        let json: Json = serde_json::from_str(
            r#"[{
                "Plan": {
                    "Node Type": "Expression",
                    "Description": "Projection",
                    "Plans": [
                        {"Node Type": "ReadFromMergeTree", "Parts": 1}
                    ]
                }
            }]"#,
        )
        .unwrap();
        let plan = walk_explain(&json);
        assert_eq!(plan.node_type, "Expression");
        assert!(plan.attributes.iter().any(|a| a.key == "Description"));
        assert_eq!(plan.children.len(), 1);
        assert_eq!(plan.children[0].node_type, "ReadFromMergeTree");
        assert!(plan.children[0].attributes.iter().any(|a| a.key == "Parts"));
    }

    #[test]
    fn handles_bare_object() {
        let json: Json =
            serde_json::from_str(r#"{"Plan": {"Node Type": "ReadFromMergeTree"}}"#).unwrap();
        let plan = walk_explain(&json);
        assert_eq!(plan.node_type, "ReadFromMergeTree");
    }
}
