import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDbtStore } from "@domains/dbt/hooks";
import { useSqlMeshStore } from "@domains/sqlmesh/hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { columnLineageIPC, readTextFileIPC, sqlmeshColumnLineageIPC } from "./ipc";
import type { LayoutDirection } from "../LineageView/types";
import type {
  ColumnLineageGraph,
  DbtLineageProject,
  EditorTabLike,
  LineageContainerViewModel,
  SqlMeshLineageProject,
} from "./types";
import {
  activeFilePath,
  fileTitle,
  focusDbtNode,
  focusSqlMeshModel,
  lineageGraph,
  mergeColumnLineage,
  traceColumnPath,
} from "./utils";

function useLineageContainer(): LineageContainerViewModel {
  const [depth, setDepth] = useState(1);
  const [direction, setDirection] = useState<LayoutDirection>("vertical");
  const [columnLineageLoading, setColumnLineageLoading] = useState(false);
  const [columnLineageData, setColumnLineageData] = useState<ColumnLineageGraph | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<{ modelId: string; column: string } | null>(null);

  const dbt = useDbtStore((state) => state.project) as DbtLineageProject | null;
  const sqlmesh = useSqlMeshStore((state) => state.project) as SqlMeshLineageProject | null;
  const activeId = useTabsStore((state) => state.activeId);
  const tabs = useTabsStore((state) => state.tabs) as EditorTabLike[];

  const filePath = useMemo(
    () => activeFilePath(activeId, tabs),
    [activeId, tabs],
  );
  const dbtFocus = useMemo(
    () => focusDbtNode(dbt, filePath),
    [dbt, filePath],
  );
  const sqlmeshFocus = useMemo(
    () => focusSqlMeshModel(sqlmesh, filePath),
    [sqlmesh, filePath],
  );
  const { nodes, edges } = useMemo(
    () => lineageGraph(dbt, dbtFocus, sqlmesh, sqlmeshFocus, depth),
    [dbt, dbtFocus, sqlmesh, sqlmeshFocus, depth],
  );

  const columnEdges = columnLineageData?.edges ?? [];

  const highlighted = useMemo(() => {
    if (!selectedColumn || !columnLineageData) return null;
    return traceColumnPath(columnEdges, selectedColumn.modelId, selectedColumn.column);
  }, [selectedColumn, columnLineageData, columnEdges]);

  const enrichedNodes = useMemo(() => {
    if (!columnLineageData) {
      if (!columnLineageLoading) return nodes;
      return nodes.map((n) => ({ ...n, loading: true }));
    }
    const merged = mergeColumnLineage(nodes, columnLineageData, highlighted);
    if (!columnLineageLoading) return merged;
    return merged.map((n) => (!n.columns ? { ...n, loading: true } : n));
  }, [nodes, columnLineageData, columnLineageLoading, highlighted]);

  const onSelectNode = useCallback(
    async (nodeId: string) => {
      if (dbt) {
        const node = dbt.nodes.find((candidate) => candidate.uniqueId === nodeId);
        if (node?.filePath) await openLineageFile(node.filePath, node.name);
        return;
      }
      if (sqlmesh) {
        const model = sqlmesh.models.find((candidate) => candidate.name === nodeId);
        if (model?.filePath) await openLineageFile(model.filePath, model.name);
      }
    },
    [dbt, sqlmesh],
  );

  const fetchDbtColumnLineage = useCallback(async (modelIds: string[]) => {
    const dbtState = useDbtStore.getState();
    const rootPath = dbtState.dbtRootPath ?? "";
    const projectName = dbtState.project?.name ?? "";
    const dbtBinary = dbtState.dbtBinaryPath || undefined;
    const scannedNodes = (dbtState.project?.nodes ?? []).map((n) => ({
      uniqueId: n.uniqueId,
      name: n.name,
      kind: n.kind ?? "model",
      filePath: n.filePath ?? "",
      dependsOn: n.dependsOn,
      columns: n.columns ?? [],
    }));
    return columnLineageIPC(rootPath, modelIds, projectName, scannedNodes, dbtBinary);
  }, []);

  const fetchSqlMeshColumnLineage = useCallback(async (modelNames: string[]) => {
    const sqlmeshState = useSqlMeshStore.getState();
    const rootPath = sqlmeshState.sqlmeshRootPath ?? "";
    const sqlmeshBinary = sqlmeshState.sqlmeshBinaryPath || undefined;
    const models = (sqlmeshState.project?.models ?? []).map((m) => ({
      name: m.name,
      kind: m.kind ?? "full",
      filePath: m.filePath ?? "",
      dependsOn: m.dependsOn,
      columns: m.columns ?? [],
    }));
    return sqlmeshColumnLineageIPC(rootPath, modelNames, models, sqlmeshBinary);
  }, []);

  const fetchColumnLineage = useCallback(async (modelIds: string[]) => {
    setColumnLineageLoading(true);
    try {
      const result = dbt
        ? await fetchDbtColumnLineage(modelIds)
        : await fetchSqlMeshColumnLineage(modelIds);
      setColumnLineageData(result);
    } catch (err) {
      console.error("Column lineage failed:", err);
    } finally {
      setColumnLineageLoading(false);
    }
  }, [dbt, fetchDbtColumnLineage, fetchSqlMeshColumnLineage]);

  const prevNodeIdsRef = useRef<string>("");
  useEffect(() => {
    if ((!dbt && !sqlmesh) || nodes.length === 0) return;
    const key = nodes.map((n) => n.id).sort().join(",");
    if (key === prevNodeIdsRef.current) return;
    prevNodeIdsRef.current = key;
    setSelectedColumn(null);
    fetchColumnLineage(nodes.map((n) => n.id));
  }, [dbt, sqlmesh, nodes, fetchColumnLineage]);

  const onSelectColumn = useCallback(
    (modelId: string, column: string) => {
      if (selectedColumn?.modelId === modelId && selectedColumn?.column === column) {
        setSelectedColumn(null);
      } else {
        setSelectedColumn({ modelId, column });
      }
    },
    [selectedColumn],
  );

  const depthOptions = useMemo(
    () => [1, 2, 3].map((value) => ({
      value,
      active: depth === value,
      onClick: () => setDepth(value),
    })),
    [depth],
  );

  const onToggleDirection = useCallback(() => {
    setDirection((d) => d === "vertical" ? "horizontal" : "vertical");
  }, []);

  return {
    depthOptions,
    direction,
    onToggleDirection,
    edges,
    nodes: enrichedNodes,
    onSelectNode,
    selectedColumn,
    onSelectColumn,
  };
}

async function openLineageFile(filePath: string, fallbackTitle: string): Promise<void> {
  const tabsStore = useTabsStore.getState();
  const existing = tabsStore.tabs.find((tab) => tab.filePath === filePath);
  if (existing) {
    tabsStore.focusTab(existing.id);
    return;
  }
  const text = await readTextFileIPC(filePath);
  tabsStore.openFileTab({
    filePath,
    title: fileTitle(filePath, fallbackTitle),
    text,
    kind: "sql",
  });
}

export {
  useLineageContainer,
};
