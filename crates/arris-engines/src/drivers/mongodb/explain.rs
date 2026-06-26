use crate::PlanNode;

use crate::drivers::common::explain::{JsonPlanConfig, plan_node_from_json};

const MONGO_PLAN_CONFIG: JsonPlanConfig = JsonPlanConfig {
    label_keys: &["stage"],
    default_label: "Plan",
    total_ms_key: Some("executionTimeMillisEstimate"),
    self_ms_key: None,
    rows_actual_key: Some("nReturned"),
    rows_estimated_key: None,
    cost_total_key: None,
    child_object_keys: &["inputStage"],
    child_array_keys: &["inputStages"],
    extra_skip_keys: &["executionStages"],
};

pub(super) fn walk_explain(v: &serde_json::Value) -> PlanNode {
    let stage = v
        .get("queryPlanner")
        .and_then(|qp| qp.get("winningPlan"))
        .or_else(|| v.get("executionStats").and_then(|e| e.get("executionStages")))
        .unwrap_or(v);
    plan_node_from_json(&MONGO_PLAN_CONFIG, stage)
}
