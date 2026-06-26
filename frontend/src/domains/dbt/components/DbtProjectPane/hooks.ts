import { useConnectionsStore } from "@domains/connection";
export {};
import { useCallback, useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useContextMenu } from "@shared/ui/ContextMenu";
import { useFilesStore } from "@domains/files/hooks";
import { findProjectRoot } from "@domains/files";
import { DBT_PROJECT_MARKERS } from "../../constants";
import { useDbtStore } from "../../hooks";
import type {
  DbtCommandKind,
  DbtContextMenuController,
  DbtNode,
  DbtProjectPaneViewModel,
} from "./types";
import {
  dbtContextMenuItems,
  filterNodesByName,
  nodesByKind,
  openDbtNode,
  openProjectFile,
  runDbtSelection,
} from "./utils";
import { joinNodeNames } from "./utils/selector";

function useDbtProjectPane(): DbtProjectPaneViewModel {
  const project = useDbtStore((state) => state.project);
  const dbtRootPath = useDbtStore((state) => state.dbtRootPath);
  const availableRoots = useDbtStore((state) => state.availableRoots);
  const isLoading = useDbtStore((state) => state.isLoading);
  const loadError = useDbtStore((state) => state.loadError);
  const profiles = useDbtStore((state) => state.profiles);
  const selectedProfile = useDbtStore((state) => state.selectedProfile);
  const selectedTarget = useDbtStore((state) => state.selectedTarget);
  const dbtBinaryPath = useDbtStore((state) => state.dbtBinaryPath);
  const cliVersion = useDbtStore((state) => state.cliVersion);
  const cliError = useDbtStore((state) => state.cliError);
  const setBinaryPath = useDbtStore((state) => state.setBinaryPath);
  const selectProfile = useDbtStore((state) => state.selectProfile);
  const selectTarget = useDbtStore((state) => state.selectTarget);
  const loadProfiles = useDbtStore((state) => state.loadProfiles);
  const checkCliVersion = useDbtStore((state) => state.checkCliVersion);
  const selectedNodeId = useDbtStore((state) => state.selectedNodeId);
  const onSelectNode = useDbtStore((state) => state.selectNode);
  const runSelectionIds = useDbtStore((state) => state.runSelectionIds);
  const runningCommand = useDbtStore((state) => state.runningCommand);
  const onToggleRunSelection = useDbtStore((state) => state.toggleRunSelection);
  const pickedConnectionId = useDbtStore((state) => state.pickedConnectionId);
  const pickConnection = useDbtStore((state) => state.pickConnection);
  const connectionList = useConnectionsStore((state) => state.connections);
  const tree = useFilesStore((state) => state.tree);

  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const ctxMenu = useContextMenu<DbtNode | null>() as DbtContextMenuController;

  const onRetry = useCallback(() => {
    const rootPath = dbtRootPath ?? (tree ? findProjectRoot(tree, DBT_PROJECT_MARKERS) : null);
    if (!rootPath) return;
    // Re-validate the CLI and profiles too, not just rescan the project, so a
    // stale "dbt executable not found" error clears once the binary is fixed.
    const store = useDbtStore.getState();
    store.loadFromPath(rootPath);
    store.loadProfiles(rootPath);
    store.checkCliVersion(rootPath);
  }, [dbtRootPath, tree]);

  useEffect(() => {
    if (!project) return;
    loadProfiles(project.rootPath);
    checkCliVersion(project.rootPath);
  }, [project?.rootPath, loadProfiles, checkCliVersion]);

  const onAlertClose = useCallback(() => {
    setAlertMessage(null);
  }, []);

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

  const onNodeAlert = useCallback((message: string) => {
    setAlertMessage(message);
  }, []);

  const onToggleSettings = useCallback(() => {
    setSettingsExpanded((value) => !value);
  }, []);

  const onFilterChange = useCallback((value: string) => {
    setFilterText(value);
  }, []);

  const onOpenFile = useCallback((path: string) => {
    openProjectFile(path).catch(() => {});
  }, []);

  const onRunCommand = useCallback((kind: DbtCommandKind, select: string) => {
    runDbtSelection(kind, select, "").catch(() => {});
  }, []);

  // Switch the active dbt project; the profiles/CLI effect above reacts to the
  // new rootPath, so only the rescan needs triggering here.
  const onSelectProject = useCallback((root: string) => {
    useDbtStore.getState().loadFromPath(root);
  }, []);

  const projectOptions = availableRoots.map((root) => ({
    value: root,
    label: root.split("/").filter(Boolean).pop() ?? root,
  }));

  const currentProfile = profiles.find((profile) => profile.name === selectedProfile);
  const allGrouped = nodesByKind(project);
  const grouped = filterNodesByName(allGrouped, filterText);
  const targets = currentProfile?.targets ?? [];

  // Seed the run selector from any multi-selected (ctrl/cmd-click) node names;
  // empty otherwise so the default Run targets the whole project.
  const selectedNames = (project?.nodes ?? [])
    .filter((node) => runSelectionIds.includes(node.uniqueId))
    .map((node) => node.name);
  const runInitialSelect = selectedNames.length > 0 ? joinNodeNames(selectedNames) : "";

  return {
    alertMessage,
    cliError,
    cliVersion,
    connections: connectionList.map((connection) => ({
      id: connection.id,
      name: connection.name || connection.id,
      kind: connection.kind,
    })),
    contextMenuItems: dbtContextMenuItems(ctxMenu.state?.context ?? null, dbtRootPath),
    ctxMenu,
    dbtBinaryPath,
    dbtRootPath,
    errorExpanded,
    filterText,
    grouped,
    isLoading,
    loadError,
    onAlertClose,
    onBinaryPathChange,
    onBrowseBinary,
    onContextMenuTree,
    onErrorToggle,
    onFilterChange,
    onNodeAlert,
    onOpenFile,
    onRetry,
    onRunCommand,
    onSelectNode,
    onSelectProject,
    onToggleRunSelection,
    onToggleSettings,
    pickConnection,
    projectOptions,
    pickedConnectionId,
    profiles,
    projectReady: Boolean(dbtRootPath || project || loadError || isLoading),
    runInitialSelect,
    runningType: runningCommand?.type ?? null,
    runSelectionIds,
    selectedNodeId,
    selectedProfile,
    selectedTarget,
    selectProfile,
    selectTarget,
    settingsExpanded,
    targets,
  };
}

function useDbtNodeRow(
  node: DbtNode,
  onAlert: (message: string) => void,
): { onDoubleClickNode: () => void } {
  const pickedConnectionId = useDbtStore((state) => state.pickedConnectionId);

  const onDoubleClickNode = useCallback(() => {
    openDbtNode(node, pickedConnectionId, onAlert).catch((error) => {
      onAlert(String(error));
    });
  }, [node, onAlert, pickedConnectionId]);

  return { onDoubleClickNode };
}

export {
  useDbtNodeRow,
  useDbtProjectPane,
};
