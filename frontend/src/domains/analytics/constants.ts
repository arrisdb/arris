import type { AnalyticsSection, AnalyticsTool } from "./types";

const ANALYTICS_TOOLS: AnalyticsTool[] = ["dbt", "sqlmesh"];

// Only dbt caches compiled SQL (target/compiled) next to the project.
const HAS_COMPILED_SQL: Record<AnalyticsTool, boolean> = { dbt: true, sqlmesh: false };

const TOOL_LABELS: Record<AnalyticsTool, string> = { dbt: "dbt", sqlmesh: "SQLMesh" };

const MODELS_CMD: Record<AnalyticsTool, string> = {
  dbt: "dbt_models",
  sqlmesh: "sqlmesh_models",
};
const MODEL_CMD: Record<AnalyticsTool, string> = { dbt: "dbt_model", sqlmesh: "sqlmesh_model" };
const LINEAGE_CMD: Record<AnalyticsTool, string> = {
  dbt: "dbt_lineage",
  sqlmesh: "sqlmesh_lineage",
};
const TOOL_RUN_LIST_CMD = "tool_run_list";
const TOOL_RUN_GET_CMD = "tool_run_get";
const TOOL_RUNS_CHANGED_EVENT = "tool_runs_changed";

const SECTION_LABELS: Record<AnalyticsSection, string> = {
  models: "Models",
  lineage: "Lineage",
  runs: "Runs",
};
const SECTIONS: AnalyticsSection[] = ["models", "lineage", "runs"];
// Page query param naming a subfolder project, as `arris dbt|sqlmesh --dir` prints it.
const DIR_QUERY_PARAM = "dir";

export {
  ANALYTICS_TOOLS,
  DIR_QUERY_PARAM,
  HAS_COMPILED_SQL,
  LINEAGE_CMD,
  MODELS_CMD,
  MODEL_CMD,
  SECTIONS,
  SECTION_LABELS,
  TOOL_LABELS,
  TOOL_RUNS_CHANGED_EVENT,
  TOOL_RUN_GET_CMD,
  TOOL_RUN_LIST_CMD,
};
