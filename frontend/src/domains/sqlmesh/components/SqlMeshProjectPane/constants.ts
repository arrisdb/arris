import type { SqlMeshPaneContextMenuItems, SqlMeshSection } from "./types";

const SQLMESH_CONFIG_MARKERS = ["config.yaml", "config.yml"];

/// Substring of the backend `SqlMeshError::NotSqlMeshProject` message. A
/// candidate dir whose `config.yaml` lacks SQLMesh-distinctive keys fails the
/// scan with this; the store uses it to keep the SQLMesh tab hidden (rather than
/// surfacing a load error) for what is simply not a SQLMesh project.
const NOT_SQLMESH_PROJECT_MARKER = "not a SQLMesh project";

const SQLMESH_SETTINGS_KEY = "sqlmesh-settings";

const SQLMESH_MODEL_SECTIONS: SqlMeshSection[] = [
  { key: "incremental", label: "Incremental" },
  { key: "full", label: "Full" },
  { key: "scd", label: "SCD Type 2" },
  { key: "view", label: "Views" },
  { key: "seed", label: "Seeds" },
  { key: "external", label: "External" },
  { key: "python", label: "Python" },
];

const SQLMESH_CLI_ERROR_PREVIEW_LINES = 3;

const SQLMESH_PANE_CONTEXT_MENU_ITEMS: SqlMeshPaneContextMenuItems = () => [];

const PROJECT_RUN_COMMANDS: { kind: "plan" | "run" | "test"; label: string }[] = [
  { kind: "plan", label: "Plan" },
  { kind: "run", label: "Run" },
  { kind: "test", label: "Test" },
];

export {
  NOT_SQLMESH_PROJECT_MARKER,
  PROJECT_RUN_COMMANDS,
  SQLMESH_CLI_ERROR_PREVIEW_LINES,
  SQLMESH_CONFIG_MARKERS,
  SQLMESH_MODEL_SECTIONS,
  SQLMESH_PANE_CONTEXT_MENU_ITEMS,
  SQLMESH_SETTINGS_KEY,
};
