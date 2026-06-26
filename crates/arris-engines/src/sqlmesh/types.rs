use serde::{Deserialize, Serialize};

pub use crate::dbt::{
    ColumnLineageEdge, ColumnLineageGraph, ColumnLineageNode, LineageEdge, LineageGraph,
    LineageNode,
};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SqlMeshConfig {
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub default_gateway: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SqlMeshModel {
    pub name: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub raw_sql: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlMeshColumnDoc {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    pub r#type: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedSqlMeshModel {
    pub name: String,
    pub kind: String,
    pub file_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub depends_on: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<SqlMeshColumnDoc>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedSqlMeshTest {
    pub name: String,
    pub model: String,
    pub file_path: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedSqlMeshProject {
    pub root_path: String,
    pub models: Vec<ScannedSqlMeshModel>,
    #[serde(default)]
    pub tests: Vec<ScannedSqlMeshTest>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlMeshCommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlMeshRenderResult {
    pub model_name: String,
    pub rendered_sql: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlMeshGatewayInfo {
    pub name: String,
    pub connection_type: String,
}

/// A SQLMesh virtual environment (a named dev/prod namespace), distinct from a
/// gateway (a connection). Parsed from `sqlmesh environments` output.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlMeshEnvironmentInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiry: Option<String>,
}
