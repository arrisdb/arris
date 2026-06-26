import { useEffect, useMemo } from "react";
import { useSettingsStore } from "@shared/settings";
import { useFilesStore } from "@domains/files/hooks";
import { findProjectRoot } from "@domains/files/components/FileTreeView/utils";
import { useDbtStore } from "@domains/dbt/hooks";
import { useSqlMeshStore } from "@domains/sqlmesh/hooks";
import { DBT_PROJECT_MARKERS } from "@domains/dbt/constants";
import { SQLMESH_PROJECT_MARKERS } from "@domains/sqlmesh/constants";
import type { LeftSidebarSelector } from "./types";
import { hasProjectMetadata } from "./utils";

// Drives the Files-tab subview selector and the dbt/SQLMesh auto-detection that
// decides which subviews exist. The subview choice lives in the settings store
// (filesPaneView) so the registry's left primaries can resolve themselves from
// it; this hook only computes availability and exposes the selector handlers.
function useLeftSidebarState(): LeftSidebarSelector {
  const tab = useSettingsStore((s) => s.sidebarLeftTab);
  const filesPaneView = useSettingsStore((s) => s.filesPaneView);
  const setFilesPaneView = useSettingsStore((s) => s.setFilesPaneView);
  const tree = useFilesStore((s) => s.tree);
  const dbtProject = useDbtStore((s) => s.project);
  const dbtRootPath = useDbtStore((s) => s.dbtRootPath);
  const dbtIsLoading = useDbtStore((s) => s.isLoading);
  const sqlmeshProject = useSqlMeshStore((s) => s.project);
  const sqlmeshRootPath = useSqlMeshStore((s) => s.sqlmeshRootPath);
  const sqlmeshIsLoading = useSqlMeshStore((s) => s.isLoading);
  const sqlmeshNotProject = useSqlMeshStore((s) => s.notSqlMeshProject);

  const dbtDetected = hasProjectMetadata(dbtProject, dbtRootPath, dbtIsLoading);
  // A candidate root the backend rejected as "not a SQLMesh project" keeps
  // `sqlmeshRootPath` set (so the load doesn't re-fire), so exclude it explicitly
  // otherwise `hasProjectMetadata` would still light up the SQLMesh tab.
  const sqlmeshDetected =
    hasProjectMetadata(sqlmeshProject, sqlmeshRootPath, sqlmeshIsLoading) && !sqlmeshNotProject;
  const showSelector = tab === "files" && (dbtDetected || sqlmeshDetected);
  const treeDbtRoot = useMemo(
    () => (tree ? findProjectRoot(tree, DBT_PROJECT_MARKERS) : null),
    [tree],
  );
  const treeSqlMeshRoot = useMemo(
    () => (tree ? findProjectRoot(tree, SQLMESH_PROJECT_MARKERS) : null),
    [tree],
  );

  useEffect(() => {
    if (treeDbtRoot && !dbtProject && !dbtRootPath && !dbtIsLoading) {
      useDbtStore.getState().loadFromPath(treeDbtRoot);
    }
    if (!treeDbtRoot && dbtDetected) {
      useDbtStore.getState().reset();
    }
  }, [treeDbtRoot, dbtProject, dbtRootPath, dbtIsLoading, dbtDetected]);

  useEffect(() => {
    if (treeSqlMeshRoot && !sqlmeshProject && !sqlmeshRootPath && !sqlmeshIsLoading) {
      useSqlMeshStore.getState().loadFromPath(treeSqlMeshRoot);
    }
    if (!treeSqlMeshRoot && sqlmeshDetected) {
      useSqlMeshStore.getState().reset();
    }
  }, [treeSqlMeshRoot, sqlmeshProject, sqlmeshRootPath, sqlmeshIsLoading, sqlmeshDetected]);

  useEffect(() => {
    if (filesPaneView === "dbt" && !dbtDetected) setFilesPaneView("project");
    if (filesPaneView === "sqlmesh" && !sqlmeshDetected) setFilesPaneView("project");
  }, [filesPaneView, dbtDetected, sqlmeshDetected, setFilesPaneView]);

  return {
    filesPaneView,
    showSelector,
    dbtDetected,
    sqlmeshDetected,
    onClickProjectView: () => setFilesPaneView("project"),
    onClickDbtView: () => setFilesPaneView("dbt"),
    onClickSqlMeshView: () => setFilesPaneView("sqlmesh"),
  };
}

export {
  useLeftSidebarState,
};
