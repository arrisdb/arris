use std::collections::HashMap;
use std::sync::Arc;

use datafusion::physical_plan::{DisplayFormatType, ExecutionPlan};
use serde::{Deserialize, Serialize};

use super::impl_federated_table_provider::FederatedExec;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DagNodeType {
    Scan,
    Join,
    Aggregate,
    Sort,
    Filter,
    Projection,
    Result,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum DagNodeStatus {
    Waiting,
    Running,
    Done,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodeMetrics {
    pub rows_produced: u64,
    pub elapsed_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagNode {
    pub id: usize,
    pub node_type: DagNodeType,
    pub label: String,
    pub children: Vec<usize>,
    pub status: DagNodeStatus,
    pub metrics: Option<NodeMetrics>,
}

pub type PlanRefs = HashMap<usize, Arc<dyn ExecutionPlan>>;

/// Builds a compact, display-ready DAG from a DataFusion `ExecutionPlan` tree:
/// noise nodes are collapsed, each surviving node is classified and labelled,
/// and the original plan refs are retained for live metric extraction.
pub struct PlanDag;

impl PlanDag {
    pub fn build_dag(plan: &Arc<dyn ExecutionPlan>) -> (Vec<DagNode>, PlanRefs) {
        let mut nodes = Vec::new();
        let mut plan_refs = HashMap::new();
        Self::walk(plan, &mut nodes, &mut plan_refs);
        (nodes, plan_refs)
    }

    pub fn extract_plan_metrics(plan_ref: &dyn ExecutionPlan) -> Option<NodeMetrics> {
        let ms = plan_ref.metrics()?;
        Some(NodeMetrics {
            rows_produced: ms.output_rows().unwrap_or(0) as u64,
            elapsed_ms: ms.elapsed_compute().unwrap_or(0) as u64 / 1_000_000,
        })
    }

    pub fn scan_node_sources(dag: &[DagNode]) -> Vec<(usize, String)> {
        dag.iter()
            .filter(|n| n.node_type == DagNodeType::Scan)
            .map(|n| {
                let source = n.label.strip_prefix("Scan: ").unwrap_or(&n.label);
                (n.id, source.to_string())
            })
            .collect()
    }

    fn should_collapse(plan: &dyn ExecutionPlan) -> bool {
        let name = plan.name();
        if matches!(
            name,
            "CoalesceBatchesExec" | "RepartitionExec" | "CoalescePartitionsExec" | "SortPreservingMergeExec"
        ) {
            return true;
        }
        if name.contains("Aggregate") {
            let display = Self::plan_display(plan);
            if display.contains("mode=Partial") || display.contains("mode=Single") {
                return true;
            }
        }
        let node_type = Self::classify_node(name);
        node_type == DagNodeType::Result
    }

    fn classify_node(name: &str) -> DagNodeType {
        if name.contains("Join") {
            DagNodeType::Join
        } else if name.contains("Aggregate") {
            DagNodeType::Aggregate
        } else if name.contains("Sort") {
            DagNodeType::Sort
        } else if name.contains("Filter") {
            DagNodeType::Filter
        } else if name.contains("Projection") {
            DagNodeType::Projection
        } else if name == "FederatedExec" {
            DagNodeType::Scan
        } else {
            DagNodeType::Result
        }
    }

    fn plan_display(plan: &dyn ExecutionPlan) -> String {
        struct Wrapper<'a>(&'a dyn ExecutionPlan);
        impl<'a> std::fmt::Display for Wrapper<'a> {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                self.0.fmt_as(DisplayFormatType::Default, f)
            }
        }
        Wrapper(plan).to_string()
    }

    fn extract_bracket_value(display: &str, key: &str) -> Option<String> {
        let needle = format!("{key}=[");
        let start = display.find(&needle)? + needle.len();
        let rest = &display[start..];
        let mut depth = 1i32;
        let mut end = 0;
        for (i, c) in rest.char_indices() {
            match c {
                '[' => depth += 1,
                ']' => {
                    depth -= 1;
                    if depth == 0 {
                        end = i;
                        break;
                    }
                }
                _ => {}
            }
        }
        Some(rest[..end].to_string())
    }

    fn strip_column_refs(s: &str) -> String {
        let re_at = regex_lite::Regex::new(r"@\d+").unwrap();
        re_at.replace_all(s, "").to_string()
    }

    fn label_for_node(plan: &dyn ExecutionPlan) -> String {
        let name = plan.name();
        if name == "FederatedExec" {
            if let Some(fed) = plan.as_any().downcast_ref::<FederatedExec>() {
                return format!("Scan: {}", fed.source().dotted_name());
            }
        }

        let display = Self::plan_display(plan);
        let node_type = Self::classify_node(name);

        match node_type {
            DagNodeType::Join => {
                let join_type = display
                    .split("join_type=")
                    .nth(1)
                    .and_then(|s| s.split([',', ' ']).next())
                    .unwrap_or("Join");
                let on = Self::extract_bracket_value(&display, "on")
                    .map(|s| Self::strip_column_refs(&s))
                    .unwrap_or_default();
                if on.is_empty() {
                    format!("{join_type} Join")
                } else {
                    format!("{join_type} Join\n{on}")
                }
            }
            DagNodeType::Aggregate => {
                let gby = Self::extract_bracket_value(&display, "gby")
                    .map(|s| Self::strip_column_refs(&s))
                    .filter(|s| !s.is_empty());
                let aggr = Self::extract_bracket_value(&display, "aggr")
                    .map(|s| Self::strip_column_refs(&s))
                    .filter(|s| !s.is_empty());
                let mut parts = vec!["Aggregate".to_string()];
                if let Some(g) = gby {
                    parts.push(format!("BY {g}"));
                }
                if let Some(a) = aggr {
                    parts.push(a);
                }
                parts.join("\n")
            }
            DagNodeType::Sort => {
                let expr = Self::extract_bracket_value(&display, "expr")
                    .map(|s| Self::strip_column_refs(&s))
                    .unwrap_or_default();
                if expr.is_empty() {
                    "Sort".to_string()
                } else {
                    format!("Sort\n{expr}")
                }
            }
            DagNodeType::Filter => {
                let detail = display
                    .split(": ")
                    .nth(1)
                    .map(|s| Self::strip_column_refs(s))
                    .unwrap_or_default();
                if detail.is_empty() {
                    "Filter".to_string()
                } else {
                    format!("Filter\n{detail}")
                }
            }
            DagNodeType::Projection => {
                let expr = Self::extract_bracket_value(&display, "expr")
                    .map(|s| Self::strip_column_refs(&s))
                    .unwrap_or_default();
                if expr.is_empty() {
                    "Projection".to_string()
                } else {
                    let cols: Vec<&str> = expr.split(", ").collect();
                    if cols.len() <= 4 {
                        format!("Projection\n{expr}")
                    } else {
                        let preview = cols[..3].join(", ");
                        format!("Projection\n{preview}, +{} more", cols.len() - 3)
                    }
                }
            }
            DagNodeType::Scan => format!("Scan: {name}"),
            DagNodeType::Result => "Result".to_string(),
        }
    }

    fn walk(
        plan: &Arc<dyn ExecutionPlan>,
        nodes: &mut Vec<DagNode>,
        plan_refs: &mut PlanRefs,
    ) -> Vec<usize> {
        if Self::should_collapse(plan.as_ref()) {
            let mut child_ids = Vec::new();
            for child in plan.children() {
                child_ids.extend(Self::walk(child, nodes, plan_refs));
            }
            return child_ids;
        }

        let name = plan.name();
        let mut child_ids = Vec::new();
        for child in plan.children() {
            child_ids.extend(Self::walk(child, nodes, plan_refs));
        }

        let id = nodes.len();
        nodes.push(DagNode {
            id,
            node_type: Self::classify_node(name),
            label: Self::label_for_node(plan.as_ref()),
            children: child_ids,
            status: DagNodeStatus::Waiting,
            metrics: None,
        });
        plan_refs.insert(id, plan.clone());

        vec![id]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use datafusion::arrow::datatypes::{Field, Schema, SchemaRef};
    use datafusion::physical_expr::EquivalenceProperties;
    use datafusion::physical_plan::execution_plan::{Boundedness, EmissionType};
    use datafusion::physical_plan::{
        DisplayAs, DisplayFormatType, PlanProperties, SendableRecordBatchStream,
    };
    use datafusion::execution::TaskContext;
    use std::any::Any;
    use std::fmt;

    fn test_schema() -> SchemaRef {
        Arc::new(Schema::new(vec![Field::new("id", datafusion::arrow::datatypes::DataType::Int64, false)]))
    }

    fn test_properties(schema: SchemaRef) -> PlanProperties {
        PlanProperties::new(
            EquivalenceProperties::new(schema),
            datafusion::physical_plan::Partitioning::UnknownPartitioning(1),
            EmissionType::Final,
            Boundedness::Bounded,
        )
    }

    struct MockExec {
        name: &'static str,
        children: Vec<Arc<dyn ExecutionPlan>>,
        schema: SchemaRef,
        properties: PlanProperties,
    }

    impl MockExec {
        fn new(name: &'static str, children: Vec<Arc<dyn ExecutionPlan>>) -> Arc<dyn ExecutionPlan> {
            let schema = test_schema();
            let properties = test_properties(schema.clone());
            Arc::new(Self { name, children, schema, properties })
        }
    }

    impl fmt::Debug for MockExec {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "MockExec({})", self.name)
        }
    }

    impl DisplayAs for MockExec {
        fn fmt_as(&self, _t: DisplayFormatType, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "{}", self.name)
        }
    }

    impl ExecutionPlan for MockExec {
        fn name(&self) -> &str {
            self.name
        }
        fn as_any(&self) -> &dyn Any {
            self
        }
        fn schema(&self) -> SchemaRef {
            self.schema.clone()
        }
        fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
            self.children.iter().collect()
        }
        fn with_new_children(self: Arc<Self>, _children: Vec<Arc<dyn ExecutionPlan>>) -> datafusion::error::Result<Arc<dyn ExecutionPlan>> {
            Ok(self)
        }
        fn execute(&self, _partition: usize, _context: Arc<TaskContext>) -> datafusion::error::Result<SendableRecordBatchStream> {
            unimplemented!()
        }
        fn properties(&self) -> &PlanProperties {
            &self.properties
        }
    }

    #[test]
    fn single_scan_produces_one_node() {
        let scan = MockExec::new("FederatedExec", vec![]);
        let (dag, _) = PlanDag::build_dag(&scan);
        assert_eq!(dag.len(), 1);
        assert_eq!(dag[0].node_type, DagNodeType::Scan);
        assert_eq!(dag[0].status, DagNodeStatus::Waiting);
        assert!(dag[0].children.is_empty());
    }

    #[test]
    fn join_with_two_scans() {
        let left = MockExec::new("FederatedExec", vec![]);
        let right = MockExec::new("FederatedExec", vec![]);
        let join = MockExec::new("HashJoinExec", vec![left, right]);
        let (dag, _) = PlanDag::build_dag(&join);
        assert_eq!(dag.len(), 3);
        let join_node = &dag[2];
        assert_eq!(join_node.node_type, DagNodeType::Join);
        assert_eq!(join_node.children.len(), 2);
        assert_eq!(dag[0].node_type, DagNodeType::Scan);
        assert_eq!(dag[1].node_type, DagNodeType::Scan);
    }

    #[test]
    fn noise_nodes_collapsed() {
        let scan = MockExec::new("FederatedExec", vec![]);
        let coalesce = MockExec::new("CoalesceBatchesExec", vec![scan]);
        let repartition = MockExec::new("RepartitionExec", vec![coalesce]);
        let top = MockExec::new("ProjectionExec", vec![repartition]);
        let (dag, _) = PlanDag::build_dag(&top);
        assert_eq!(dag.len(), 2);
        assert_eq!(dag[0].node_type, DagNodeType::Scan);
        assert_eq!(dag[1].node_type, DagNodeType::Projection);
        assert_eq!(dag[1].children, vec![0]);
    }

    #[test]
    fn aggregate_classified_correctly() {
        let scan = MockExec::new("FederatedExec", vec![]);
        let agg = MockExec::new("AggregateExec", vec![scan]);
        let (dag, _) = PlanDag::build_dag(&agg);
        assert_eq!(dag.len(), 2);
        assert_eq!(dag[1].node_type, DagNodeType::Aggregate);
    }

    #[test]
    fn sort_classified_correctly() {
        let scan = MockExec::new("FederatedExec", vec![]);
        let sort = MockExec::new("SortExec", vec![scan]);
        let (dag, _) = PlanDag::build_dag(&sort);
        assert_eq!(dag.len(), 2);
        assert_eq!(dag[1].node_type, DagNodeType::Sort);
    }

    #[test]
    fn scan_node_sources_extracts_names() {
        let scan = MockExec::new("FederatedExec", vec![]);
        let top = MockExec::new("ProjectionExec", vec![scan]);
        let (dag, _) = PlanDag::build_dag(&top);
        let sources = PlanDag::scan_node_sources(&dag);
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].0, 0);
    }

    #[test]
    fn deep_plan_with_join_agg_sort() {
        let left = MockExec::new("FederatedExec", vec![]);
        let right = MockExec::new("FederatedExec", vec![]);
        let join = MockExec::new("HashJoinExec", vec![left, right]);
        let coalesce = MockExec::new("CoalesceBatchesExec", vec![join]);
        let agg = MockExec::new("AggregateExec", vec![coalesce]);
        let sort = MockExec::new("SortExec", vec![agg]);
        let (dag, _) = PlanDag::build_dag(&sort);
        assert_eq!(dag.len(), 5);
        let names: Vec<_> = dag.iter().map(|n| &n.node_type).collect();
        assert_eq!(names, vec![
            &DagNodeType::Scan,
            &DagNodeType::Scan,
            &DagNodeType::Join,
            &DagNodeType::Aggregate,
            &DagNodeType::Sort,
        ]);
        assert_eq!(dag[2].children, vec![0, 1]);
        assert_eq!(dag[3].children, vec![2]);
        assert_eq!(dag[4].children, vec![3]);
    }
}
