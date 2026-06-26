use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::QueryResult;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtCommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtCompileResult {
    pub model_name: String,
    pub compiled_sql: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtProfileInfo {
    pub name: String,
    pub default_target: String,
    pub targets: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct DbtProject {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub profile: String,
    #[serde(default)]
    pub model_paths: Vec<String>,
    #[serde(default)]
    pub macro_paths: Vec<String>,
    #[serde(default)]
    pub seed_paths: Vec<String>,
    #[serde(default)]
    pub test_paths: Vec<String>,
    #[serde(default)]
    pub snapshot_paths: Vec<String>,
    #[serde(default)]
    pub analysis_paths: Vec<String>,
    #[serde(default)]
    pub target_path: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct DbtModel {
    pub unique_id: String,
    pub name: String,
    #[serde(default)]
    pub schema: String,
    #[serde(default)]
    pub materialized: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub raw_sql: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtColumnDoc {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    pub r#type: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedNode {
    pub unique_id: String,
    pub name: String,
    pub kind: String,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    /// Model materialization (`table`/`view`/`incremental`/`ephemeral`) parsed
    /// from the model's inline `{{ config(materialized=...) }}`. `None` when not
    /// declared inline (dbt defaults to `view`) or for non-model resources.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materialized: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub depends_on: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<DbtColumnDoc>,
}

/// A macro definition discovered while scanning `macro-paths/**/*.sql`. `name`
/// is the `{% macro name(...) %}` identifier (a single file may define several);
/// `file_path` is the absolute path for editor go-to-definition.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtMacroDef {
    pub name: String,
    pub file_path: String,
}

/// A docs block discovered while scanning `.md` files. `name` is the
/// `{% docs name %}` identifier referenced by `{{ doc('name') }}`; `file_path`
/// is the absolute path for editor go-to-definition.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtDocBlock {
    pub name: String,
    pub file_path: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedProject {
    pub root_path: String,
    pub name: String,
    pub profile: String,
    pub nodes: Vec<ScannedNode>,
    /// Macro definitions keyed by macro name (for `{{ macro() }}` nav).
    pub macros: Vec<DbtMacroDef>,
    /// Docs blocks keyed by block name (for `{{ doc() }}` nav).
    pub docs: Vec<DbtDocBlock>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct LineageNode {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct LineageEdge {
    pub from: String,
    pub to: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct LineageGraph {
    pub nodes: Vec<LineageNode>,
    pub edges: Vec<LineageEdge>,
}

impl LineageGraph {
    pub fn build<F>(models: &[(String, Vec<String>)], kind_for: F) -> Self
    where
        F: Fn(&str) -> String,
    {
        let mut nodes = Vec::with_capacity(models.len());
        let mut edges = Vec::new();
        for (id, deps) in models {
            nodes.push(LineageNode {
                id: id.clone(),
                name: id.rsplit('.').next().unwrap_or(id).to_owned(),
                kind: kind_for(id),
            });
            for d in deps {
                edges.push(LineageEdge {
                    from: d.clone(),
                    to: id.clone(),
                });
            }
        }
        Self { nodes, edges }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnLineageEdge {
    pub from_model: String,
    pub from_column: String,
    pub to_model: String,
    pub to_column: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnLineageNode {
    pub model_id: String,
    pub columns: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnLineageGraph {
    pub nodes: Vec<ColumnLineageNode>,
    pub edges: Vec<ColumnLineageEdge>,
}

// -- dbt docs (manifest.json + catalog.json) ------------------------------

/// One column in a documented dbt node. `description` comes from `manifest.json`,
/// `r#type` comes from `catalog.json` (warehouse-reported type).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtDocsColumn {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
}

/// A documented dbt node (model, seed, snapshot, or source) normalized from the
/// generated artifacts for display in the docs viewer.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtDocsModel {
    pub unique_id: String,
    pub name: String,
    pub resource_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub materialized: Option<String>,
    /// Project-relative path to the node's source file (for go-to-source).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    pub columns: Vec<DbtDocsColumn>,
    pub depends_on: Vec<String>,
}

/// Normalized docs payload returned to the frontend. `schema_version_supported`
/// is `false` when `manifest.json`'s schema version is outside the tested range
/// — the frontend shows a non-blocking warning but still renders `models`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtDocs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dbt_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generated_at: Option<String>,
    pub schema_version_supported: bool,
    pub models: Vec<DbtDocsModel>,
}

// -- dbt run results (run_results.json) -----------------------------------

/// One node's outcome from `run_results.json`. `status` is dbt's raw status
/// string (`pass`/`fail`/`error`/`warn`/`skipped` for tests; `success`/`error`/
/// `skipped` for models). `failures` is the failing-row count for tests;
/// `rows_affected` comes from the adapter response for materializations.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtRunResult {
    pub unique_id: String,
    pub status: String,
    pub execution_time: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failures: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rows_affected: Option<i64>,
}

/// Normalized `run_results.json` payload returned to the frontend after a
/// `dbt run`/`test`/`build` invocation.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbtRunResults {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dbt_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generated_at: Option<String>,
    pub elapsed_time: f64,
    pub results: Vec<DbtRunResult>,
}

// -- Slim CI data-diff ----------------------------------------------------

/// How the modified model's "new side" is computed for the diff.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SlimDiffMode {
    /// Diff directly against the compiled SELECT wrapped as a subquery. No
    /// warehouse writes; the new side is recomputed each run.
    Inline,
    /// Materialize the compiled SELECT into a session `TEMP` table once, then
    /// diff against it. Faster for heavy models; dropped after the diff.
    Materialize,
}

/// Dialect-specific SQL for the `Materialize` mode's scratch table: how to
/// create it from the compiled SELECT, how to reference it, and how to drop it.
pub(super) struct TempTable {
    pub create: String,
    pub reference: String,
    pub drop: String,
}

/// Result of a keyless set-diff between a modified dbt model's output and its
/// current prod table. Counts are warehouse-computed; samples are capped row
/// sets pulled back for display. `*_only_columns` describe the schema delta.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlimDiffResult {
    pub mode: SlimDiffMode,
    pub prod_total: i64,
    pub new_total: i64,
    pub added_count: i64,
    pub removed_count: i64,
    /// Rows whose primary key exists on both sides but whose values changed.
    /// Always 0 for a keyless diff (no primary key supplied).
    pub updated_count: i64,
    /// Primary-key columns used for the diff (empty for a keyless diff).
    pub key_columns: Vec<String>,
    pub shared_columns: Vec<String>,
    pub prod_only_columns: Vec<String>,
    pub new_only_columns: Vec<String>,
    pub added_sample: QueryResult,
    pub removed_sample: QueryResult,
    /// New-side (post-change) rows for updated keys, ordered by key. Empty for a
    /// keyless diff.
    pub updated_new_sample: QueryResult,
    /// Prod-side (old) rows for the same updated keys, ordered by key so it lines
    /// up row-for-row with `updated_new_sample`. Empty for a keyless diff.
    pub updated_prod_sample: QueryResult,
    /// The SQL actually executed against the warehouse to compute this diff
    /// (counts + sample queries), surfaced for the command log.
    pub sql: String,
}

// -- Raw deserialization structs: the ONLY coupling to dbt's artifact schema.
// All optional via `#[serde(default)]` so unknown/new fields are ignored and
// missing fields degrade gracefully instead of failing the whole parse.

#[derive(Debug, Default, Deserialize)]
pub(super) struct RawManifest {
    #[serde(default)]
    pub metadata: RawManifestMetadata,
    #[serde(default)]
    pub nodes: BTreeMap<String, RawNode>,
    #[serde(default)]
    pub sources: BTreeMap<String, RawNode>,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct RawManifestMetadata {
    #[serde(default)]
    pub dbt_schema_version: Option<String>,
    #[serde(default)]
    pub dbt_version: Option<String>,
    #[serde(default)]
    pub generated_at: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct RawNode {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub resource_type: String,
    #[serde(default)]
    pub source_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub original_file_path: Option<String>,
    #[serde(default)]
    pub config: RawNodeConfig,
    #[serde(default)]
    pub columns: BTreeMap<String, RawColumn>,
    #[serde(default)]
    pub depends_on: RawDependsOn,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct RawNodeConfig {
    #[serde(default)]
    pub materialized: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct RawColumn {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub data_type: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct RawDependsOn {
    #[serde(default)]
    pub nodes: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct RawCatalog {
    #[serde(default)]
    pub nodes: BTreeMap<String, RawCatalogNode>,
    #[serde(default)]
    pub sources: BTreeMap<String, RawCatalogNode>,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct RawCatalogNode {
    #[serde(default)]
    pub columns: BTreeMap<String, RawCatalogColumn>,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct RawCatalogColumn {
    #[serde(default)]
    pub name: String,
    #[serde(default, rename = "type")]
    pub r#type: Option<String>,
    /// 1-based ordinal position in the warehouse; used to order columns for display.
    #[serde(default)]
    pub index: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct RawRunResults {
    #[serde(default)]
    pub metadata: RawManifestMetadata,
    #[serde(default)]
    pub results: Vec<RawRunResult>,
    #[serde(default)]
    pub elapsed_time: f64,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct RawRunResult {
    #[serde(default)]
    pub unique_id: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub execution_time: f64,
    #[serde(default)]
    pub message: Option<String>,
    /// Failing-row count for data/generic tests (`null` for non-test nodes).
    #[serde(default)]
    pub failures: Option<i64>,
    #[serde(default)]
    pub adapter_response: RawAdapterResponse,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct RawAdapterResponse {
    #[serde(default)]
    pub rows_affected: Option<i64>,
}

#[derive(Debug, Clone)]
pub(super) struct SchemaDocEntry {
    pub name: String,
    pub description: Option<String>,
    pub columns: Vec<DbtColumnDoc>,
}

pub(super) struct ParsedSchemaYaml {
    pub model_docs: Vec<SchemaDocEntry>,
    pub source_nodes: Vec<ScannedNode>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lineage_build_creates_nodes_and_edges() {
        let models = vec![
            ("model.app.users".to_string(), vec![]),
            (
                "model.app.orders".to_string(),
                vec!["model.app.users".to_string()],
            ),
            (
                "model.app.summary".to_string(),
                vec!["model.app.orders".to_string()],
            ),
        ];
        let g = LineageGraph::build(&models, |_| "model".into());
        assert_eq!(g.nodes.len(), 3);
        assert_eq!(g.edges.len(), 2);
        assert_eq!(g.edges[0].from, "model.app.users");
        assert_eq!(g.edges[0].to, "model.app.orders");
    }

    #[test]
    fn lineage_node_name_uses_last_segment() {
        let models = vec![("model.proj.mymodel".to_string(), vec![])];
        let g = LineageGraph::build(&models, |_| "model".into());
        assert_eq!(g.nodes[0].name, "mymodel");
    }

    #[test]
    fn lineage_empty_models_produces_empty_graph() {
        let g = LineageGraph::build(&[], |_| "model".into());
        assert!(g.nodes.is_empty());
        assert!(g.edges.is_empty());
    }

    #[test]
    fn column_lineage_graph_default_is_empty() {
        let g = ColumnLineageGraph::default();
        assert!(g.nodes.is_empty());
        assert!(g.edges.is_empty());
    }

    #[test]
    fn column_lineage_edge_serializes_camel_case() {
        let edge = ColumnLineageEdge {
            from_model: "model.app.users".into(),
            from_column: "id".into(),
            to_model: "model.app.orders".into(),
            to_column: "user_id".into(),
        };
        let json = serde_json::to_string(&edge).unwrap();
        assert!(json.contains("fromModel"));
        assert!(json.contains("fromColumn"));
        assert!(json.contains("toModel"));
        assert!(json.contains("toColumn"));
    }

    #[test]
    fn column_lineage_node_serializes_camel_case() {
        let node = ColumnLineageNode {
            model_id: "model.app.users".into(),
            columns: vec!["id".into(), "name".into()],
        };
        let json = serde_json::to_string(&node).unwrap();
        assert!(json.contains("modelId"));
    }
}
