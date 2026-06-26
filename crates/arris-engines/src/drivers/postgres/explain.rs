use crate::PlanNode;

use crate::drivers::common::explain::{JsonPlanConfig, plan_node_from_json};

pub(super) const PG_PLAN_CONFIG: JsonPlanConfig = JsonPlanConfig {
    label_keys: &["Node Type"],
    default_label: "Plan",
    total_ms_key: Some("Actual Total Time"),
    self_ms_key: Some("Actual Self Time"),
    rows_actual_key: Some("Actual Rows"),
    rows_estimated_key: Some("Plan Rows"),
    cost_total_key: Some("Total Cost"),
    child_object_keys: &[],
    child_array_keys: &["Plans"],
    extra_skip_keys: &[],
};

pub(super) fn walk_explain(v: &serde_json::Value) -> PlanNode {
    let arr = v.as_array().and_then(|a| a.first());
    let plan = arr
        .and_then(|root| root.get("Plan"))
        .unwrap_or(&serde_json::Value::Null);
    plan_node_from_json(&PG_PLAN_CONFIG, plan)
}
