use crate::{PlanAttribute, PlanNode};
use serde_json::Value;

pub struct JsonPlanConfig {
    pub label_keys: &'static [&'static str],
    pub default_label: &'static str,
    pub total_ms_key: Option<&'static str>,
    pub self_ms_key: Option<&'static str>,
    pub rows_actual_key: Option<&'static str>,
    pub rows_estimated_key: Option<&'static str>,
    pub cost_total_key: Option<&'static str>,
    pub child_object_keys: &'static [&'static str],
    pub child_array_keys: &'static [&'static str],
    pub extra_skip_keys: &'static [&'static str],
}

impl JsonPlanConfig {
    fn is_skip_key(&self, key: &str) -> bool {
        self.label_keys.contains(&key)
            || self.child_object_keys.contains(&key)
            || self.child_array_keys.contains(&key)
            || self.extra_skip_keys.contains(&key)
            || self.total_ms_key == Some(key)
            || self.self_ms_key == Some(key)
            || self.rows_actual_key == Some(key)
            || self.rows_estimated_key == Some(key)
            || self.cost_total_key == Some(key)
    }
}

pub fn plan_node_from_json(config: &JsonPlanConfig, v: &Value) -> PlanNode {
    let label = config
        .label_keys
        .iter()
        .find_map(|k| v.get(*k).and_then(|x| x.as_str()))
        .unwrap_or(config.default_label)
        .to_owned();

    let mut node = PlanNode::new(label.clone(), label);
    node.total_ms = config.total_ms_key.and_then(|k| v.get(k)?.as_f64());
    node.self_ms = config.self_ms_key.and_then(|k| v.get(k)?.as_f64());
    node.rows_actual = config.rows_actual_key.and_then(|k| v.get(k)?.as_f64());
    node.rows_estimated = config.rows_estimated_key.and_then(|k| v.get(k)?.as_f64());
    node.cost_total = config.cost_total_key.and_then(|k| v.get(k)?.as_f64());

    node.attributes = collect_plan_attributes(v, |k| config.is_skip_key(k));

    for key in config.child_object_keys {
        if let Some(child) = v.get(*key) {
            node.children.push(plan_node_from_json(config, child));
        }
    }
    for key in config.child_array_keys {
        if let Some(arr) = v.get(*key).and_then(|x| x.as_array()) {
            for c in arr {
                node.children.push(plan_node_from_json(config, c));
            }
        }
    }
    node
}

pub fn collect_plan_attributes(v: &Value, skip: impl Fn(&str) -> bool) -> Vec<PlanAttribute> {
    let Some(obj) = v.as_object() else {
        return Vec::new();
    };
    let mut attrs = Vec::new();
    for (k, val) in obj {
        if skip(k) {
            continue;
        }
        let s = match val {
            Value::String(s) => s.clone(),
            Value::Null => continue,
            other => other.to_string(),
        };
        attrs.push(PlanAttribute::new(k, s));
    }
    attrs
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_CONFIG: JsonPlanConfig = JsonPlanConfig {
        label_keys: &["Node Type"],
        default_label: "Plan",
        total_ms_key: Some("Actual Total Time"),
        self_ms_key: None,
        rows_actual_key: Some("Actual Rows"),
        rows_estimated_key: Some("Plan Rows"),
        cost_total_key: Some("Total Cost"),
        child_object_keys: &[],
        child_array_keys: &["Plans"],
        extra_skip_keys: &[],
    };

    #[test]
    fn extracts_label_and_metrics() {
        let v: Value = serde_json::from_str(
            r#"{"Node Type": "Seq Scan", "Total Cost": 12.5, "Plan Rows": 100, "Actual Rows": 99}"#,
        )
        .unwrap();
        let node = plan_node_from_json(&TEST_CONFIG, &v);
        assert_eq!(node.label, "Seq Scan");
        assert_eq!(node.cost_total, Some(12.5));
        assert_eq!(node.rows_estimated, Some(100.0));
        assert_eq!(node.rows_actual, Some(99.0));
    }

    #[test]
    fn uses_default_label_when_key_missing() {
        let v: Value = serde_json::from_str(r#"{"Total Cost": 1.0}"#).unwrap();
        let node = plan_node_from_json(&TEST_CONFIG, &v);
        assert_eq!(node.label, "Plan");
    }

    #[test]
    fn collects_remaining_keys_as_attributes() {
        let v: Value =
            serde_json::from_str(r#"{"Node Type": "Scan", "Relation Name": "users", "Filter": "id > 5"}"#)
                .unwrap();
        let node = plan_node_from_json(&TEST_CONFIG, &v);
        assert_eq!(node.attributes.len(), 2);
        assert!(node.attributes.iter().any(|a| a.key == "Relation Name"));
        assert!(node.attributes.iter().any(|a| a.key == "Filter"));
    }

    #[test]
    fn recurses_into_children_array() {
        let v: Value = serde_json::from_str(
            r#"{"Node Type": "Merge Join", "Plans": [{"Node Type": "Sort"}, {"Node Type": "Index Scan"}]}"#,
        )
        .unwrap();
        let node = plan_node_from_json(&TEST_CONFIG, &v);
        assert_eq!(node.children.len(), 2);
        assert_eq!(node.children[0].label, "Sort");
        assert_eq!(node.children[1].label, "Index Scan");
    }

    #[test]
    fn recurses_into_child_object_keys() {
        let config = JsonPlanConfig {
            label_keys: &["stage"],
            default_label: "Plan",
            total_ms_key: None,
            self_ms_key: None,
            rows_actual_key: None,
            rows_estimated_key: None,
            cost_total_key: None,
            child_object_keys: &["inputStage"],
            child_array_keys: &[],
            extra_skip_keys: &[],
        };
        let v: Value = serde_json::from_str(
            r#"{"stage": "COLLSCAN", "inputStage": {"stage": "IXSCAN"}}"#,
        )
        .unwrap();
        let node = plan_node_from_json(&config, &v);
        assert_eq!(node.children.len(), 1);
        assert_eq!(node.children[0].label, "IXSCAN");
    }

    #[test]
    fn skips_null_attribute_values() {
        let v: Value =
            serde_json::from_str(r#"{"Node Type": "Scan", "Alias": null, "Table": "t"}"#)
                .unwrap();
        let node = plan_node_from_json(&TEST_CONFIG, &v);
        assert_eq!(node.attributes.len(), 1);
        assert_eq!(node.attributes[0].key, "Table");
    }
}
