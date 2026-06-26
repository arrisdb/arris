import { registerPane } from "@shared";
import { useSettingsStore } from "@shared/settings";
import { SqlMeshProjectPane } from "./components/SqlMeshProjectPane";
import { SqlMeshToolbar } from "./components/SqlMeshToolbar";
import { SqlMeshTestToolbar } from "./components/SqlMeshTestToolbar";
import { sqlmeshTestNameAtCursor } from "./utils/navigation/sqlmeshTestNav";
import { SQLMESH_PROJECT_MARKERS } from "./constants";

function registerSqlMeshPane(): void {
  registerPane({
    id: "sqlmesh",
    side: "left",
    kind: "primary",
    priority: 20,
    title: "SQLMesh",
    useActive: () =>
      useSettingsStore((s) => s.sidebarLeftTab === "files" && s.filesPaneView === "sqlmesh"),
    Component: SqlMeshProjectPane,
  });
}

export {
  SqlMeshProjectPane,
  SqlMeshToolbar,
  SqlMeshTestToolbar,
  sqlmeshTestNameAtCursor,
  registerSqlMeshPane,
  SQLMESH_PROJECT_MARKERS,
};
export { useSqlMeshStore } from "./hooks";
export type { SqlMeshModel } from "./components/SqlMeshProjectPane/types";
