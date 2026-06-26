import { useConnectionsStore } from "@domains/connection";
import { useCallback, useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useContextMenu } from "@shared/ui/ContextMenu";
import { useFilesStore } from "@domains/files/hooks";
import { findProjectRoot } from "@domains/files";
import {
  SQLMESH_CONFIG_MARKERS,
} from "./constants";
import { useSqlMeshStore } from "../../hooks";
import type {
  SqlMeshModel,
  SqlMeshProjectPaneViewModel,
} from "./types";
import {
  applyConnectionToSqlMeshTabs,
  filterModelsByName,
  modelsByKind,
  openProjectFile,
  planSqlMeshProject,
  runSqlMeshProject,
  testSqlMeshProject,
  sqlMeshContextMenuItems,
  testsByName,
} from "./utils";

function useSqlMeshProjectPane(): SqlMeshProjectPaneViewModel {
  const project = useSqlMeshStore((state) => state.project);
  const sqlmeshRootPath = useSqlMeshStore((state) => state.sqlmeshRootPath);
  const availableRoots = useSqlMeshStore((state) => state.availableRoots);
  const isLoading = useSqlMeshStore((state) => state.isLoading);
  const loadError = useSqlMeshStore((state) => state.loadError);
  const gateways = useSqlMeshStore((state) => state.gateways);
  const selectedGateway = useSqlMeshStore((state) => state.selectedGateway);
  const environments = useSqlMeshStore((state) => state.environments);
  const selectedEnvironment = useSqlMeshStore((state) => state.selectedEnvironment);
  const sqlmeshBinaryPath = useSqlMeshStore((state) => state.sqlmeshBinaryPath);
  const cliVersion = useSqlMeshStore((state) => state.cliVersion);
  const cliError = useSqlMeshStore((state) => state.cliError);
  const setBinaryPath = useSqlMeshStore((state) => state.setBinaryPath);
  const selectGateway = useSqlMeshStore((state) => state.selectGateway);
  const selectEnvironment = useSqlMeshStore((state) => state.selectEnvironment);
  const loadGateways = useSqlMeshStore((state) => state.loadGateways);
  const loadEnvironments = useSqlMeshStore((state) => state.loadEnvironments);
  const promoteEnvironment = useSqlMeshStore((state) => state.promoteEnvironment);
  const checkCliVersion = useSqlMeshStore((state) => state.checkCliVersion);
  const selectedModel = useSqlMeshStore((state) => state.selectedModel);
  const onSelectModel = useSqlMeshStore((state) => state.selectModel);
  const pickedConnectionId = useSqlMeshStore((state) => state.pickedConnectionId);
  const pickConnectionInStore = useSqlMeshStore((state) => state.pickConnection);
  const runningCommand = useSqlMeshStore((state) => state.runningCommand);
  const connectionList = useConnectionsStore((state) => state.connections);
  const tree = useFilesStore((state) => state.tree);

  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [promoteStatus, setPromoteStatus] = useState<string | null>(null);
  const ctxMenu = useContextMenu<SqlMeshModel | null>();

  const onRetry = useCallback(() => {
    const rootPath = sqlmeshRootPath
      ?? (tree ? findProjectRoot(tree, SQLMESH_CONFIG_MARKERS) : null);
    if (rootPath) useSqlMeshStore.getState().loadFromPath(rootPath);
  }, [sqlmeshRootPath, tree]);

  useEffect(() => {
    if (!project) return;
    loadGateways(project.rootPath);
    loadEnvironments(project.rootPath);
    checkCliVersion(project.rootPath);
  }, [project?.rootPath, loadGateways, loadEnvironments, checkCliVersion]);

  const onBinaryPathChange = useCallback((value: string) => {
    setBinaryPath(value);
  }, [setBinaryPath]);

  const onBrowseBinary = useCallback(async () => {
    const picked = await openDialog({ directory: false, multiple: false });
    if (typeof picked === "string") setBinaryPath(picked);
  }, [setBinaryPath]);

  const onContextMenuTree = useCallback((event: ReactMouseEvent) => {
    ctxMenu.open(event, null);
  }, [ctxMenu]);

  const onErrorToggle = useCallback(() => {
    setErrorExpanded((value) => !value);
  }, []);

  const onToggleSettings = useCallback(() => {
    setSettingsExpanded((value) => !value);
  }, []);

  const onFilterChange = useCallback((value: string) => {
    setFilterText(value);
  }, []);

  const onOpenFile = useCallback((path: string, anchorName?: string) => {
    openProjectFile(path, anchorName).catch(() => {});
  }, []);

  const onRunProject = useCallback((kind: "plan" | "run" | "test") => {
    const command =
      kind === "plan"
        ? planSqlMeshProject()
        : kind === "test"
          ? testSqlMeshProject()
          : runSqlMeshProject();
    command.catch(() => {});
  }, []);

  const pickConnection = useCallback((id: string | null) => {
    pickConnectionInStore(id);
    applyConnectionToSqlMeshTabs(id);
  }, [pickConnectionInStore]);

  // Switch the active sqlmesh project; the gateways/environments/CLI effect
  // above reacts to the new rootPath, so only the rescan needs triggering here.
  const onSelectProject = useCallback((root: string) => {
    useSqlMeshStore.getState().loadFromPath(root);
  }, []);

  const projectOptions = availableRoots.map((root) => ({
    value: root,
    label: root.split("/").filter(Boolean).pop() ?? root,
  }));

  const onPromote = useCallback(async () => {
    setPromoting(true);
    setPromoteStatus("Promoting to prod…");
    try {
      const result = await promoteEnvironment("prod");
      setPromoteStatus(
        result.exitCode === 0
          ? `Promoted to prod (${result.durationMs} ms)`
          : `Promote failed (exit ${result.exitCode})`,
      );
    } catch (error) {
      setPromoteStatus(`Promote failed: ${String(error)}`);
    } finally {
      setPromoting(false);
    }
  }, [promoteEnvironment]);

  const allGrouped = modelsByKind(project);
  const grouped = filterModelsByName(allGrouped, filterText);
  const tests = testsByName(project, filterText);

  return {
    cliError,
    cliVersion,
    connections: connectionList.map((connection) => ({
      id: connection.id,
      name: connection.name || connection.id,
      kind: connection.kind,
    })),
    contextMenuItems: sqlMeshContextMenuItems(ctxMenu.state?.context ?? null, sqlmeshRootPath),
    ctxMenu,
    environments,
    errorExpanded,
    filterText,
    gateways,
    grouped,
    tests,
    isLoading,
    loadError,
    onBinaryPathChange,
    onBrowseBinary,
    onContextMenuTree,
    onErrorToggle,
    onFilterChange,
    onOpenFile,
    onPromote,
    onRetry,
    onRunProject,
    onSelectModel,
    onToggleSettings,
    runningCommandType: runningCommand?.type ?? null,
    pickConnection,
    pickedConnectionId,
    projectReady: Boolean(sqlmeshRootPath || project || loadError || isLoading),
    projectOptions,
    onSelectProject,
    promoteStatus,
    promoting,
    sqlmeshRootPath,
    selectEnvironment,
    selectGateway,
    selectedEnvironment,
    selectedGateway,
    selectedModel,
    settingsExpanded,
    sqlmeshBinaryPath,
  };
}

export { useSqlMeshProjectPane };
