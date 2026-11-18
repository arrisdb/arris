type AnalyticsTool = "dbt" | "sqlmesh";

type AnalyticsSection = "models" | "lineage" | "runs";

/// dbt and sqlmesh model summaries share `name`, `dependsOn` and `path`; the rest is per tool.
interface ModelSummary {
  name: string;
  uniqueId?: string;
  schema?: string | null;
  materialized?: string | null;
  kind?: string;
  cron?: string | null;
  owner?: string | null;
  dependsOn: string[];
  path: string;
}

interface ModelsResponse {
  projectName?: string;
  root: string;
  models: ModelSummary[];
}

interface ColumnDoc {
  name: string;
  description?: string;
  type?: string;
}

interface ModelDetail extends ModelSummary {
  description: string | null;
  rawSql: string;
  compiledSql?: string | null;
  columns: ColumnDoc[];
  upstream: string[];
  downstream: string[];
}

interface GraphNode {
  id: string;
  name: string;
  kind: string;
}

interface GraphEdge {
  from: string;
  to: string;
}

interface ColumnLineageGraph {
  nodes: Array<{ modelId: string; columns: string[] }>;
  edges: Array<{ fromModel: string; fromColumn: string; toModel: string; toColumn: string }>;
}

interface LineageResponse {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  columns?: ColumnLineageGraph;
}

interface SelectedColumn {
  modelId: string;
  column: string;
}

interface ToolRunSummary {
  success: number;
  error: number;
  skipped: number;
  warn: number;
  failed: string[];
}

interface ToolRunMeta {
  id: string;
  tool: AnalyticsTool;
  args: string[];
  dir: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  summary: ToolRunSummary | null;
}

interface ToolRunRecord extends ToolRunMeta {
  outputTail: string;
}

export type {
  AnalyticsSection,
  AnalyticsTool,
  ColumnDoc,
  ColumnLineageGraph,
  GraphNode,
  LineageResponse,
  ModelDetail,
  ModelSummary,
  ModelsResponse,
  SelectedColumn,
  ToolRunMeta,
  ToolRunRecord,
  ToolRunSummary,
};
