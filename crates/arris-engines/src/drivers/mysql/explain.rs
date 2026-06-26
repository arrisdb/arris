use crate::PlanNode;

use crate::drivers::common::explain::collect_plan_attributes;

pub(super) fn walk_mysql_plan(v: &serde_json::Value) -> PlanNode {
    let block = v.get("query_block").unwrap_or(v);
    plan_from_mysql(block, "query_block")
}

pub(super) fn plan_from_mysql(v: &serde_json::Value, default_label: &str) -> PlanNode {
    let label = v
        .get("table_name")
        .and_then(|s| s.as_str())
        .map(|s| format!("Table: {s}"))
        .or_else(|| {
            v.get("operation")
                .and_then(|s| s.as_str())
                .map(|s| s.to_owned())
        })
        .unwrap_or_else(|| default_label.to_owned());

    let mut node = PlanNode::new(label.clone(), label);

    if let Some(cost) = v
        .get("cost_info")
        .and_then(|c| c.get("query_cost").or_else(|| c.get("read_cost")))
    {
        node.cost_total = match cost {
            serde_json::Value::String(s) => s.parse().ok(),
            serde_json::Value::Number(n) => n.as_f64(),
            _ => None,
        };
    }
    if let Some(rows) = v.get("rows_examined_per_scan").and_then(|x| x.as_u64()) {
        node.rows_estimated = Some(rows as f64);
    }
    if let Some(rows) = v.get("rows_produced_per_join").and_then(|x| x.as_u64()) {
        node.rows_actual = Some(rows as f64);
    }

    const SKIP_KEYS: &[&str] = &[
        "nested_loop",
        "table",
        "ordering_operation",
        "grouping_operation",
        "duplicates_removal",
        "windowing",
        "select_list_subqueries",
        "having_subqueries",
        "cost_info",
    ];
    node.attributes = collect_plan_attributes(v, |k| SKIP_KEYS.contains(&k));

    if let Some(arr) = v.get("nested_loop").and_then(|x| x.as_array()) {
        for c in arr {
            // Each entry in `nested_loop` is `{ "table": {...} }`. Skip the
            // wrapper so the resulting tree shows the table directly.
            let inner = c.get("table").unwrap_or(c);
            node.children.push(plan_from_mysql(inner, "Nested Loop"));
        }
    }
    if let Some(t) = v.get("table") {
        if v.get("nested_loop").is_none() {
            node.children.push(plan_from_mysql(t, "Table"));
        }
    }
    for child_key in [
        "ordering_operation",
        "grouping_operation",
        "duplicates_removal",
        "windowing",
    ] {
        if let Some(c) = v.get(child_key) {
            node.children.push(plan_from_mysql(c, child_key));
        }
    }

    node
}
