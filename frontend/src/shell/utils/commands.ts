import { useConnectionsStore, useSchemaUiStore } from "@domains/connection/hooks";
import { useResultsTableStore, useRunHistoryStore } from "@domains/results/hooks";
import { usePinnedQueriesStore } from "@domains/pinnedQueries/hooks";
import { useEffect, useRef } from "react";
import { EditorView } from "@codemirror/view";
import {
  closeActiveTab,
  executeActiveQuery,
  exportActiveResults,
  openNewConsoleTab,
  saveActiveFile,
  stopActiveQuery,
} from "@domains/editor/components/EditorPane/utils";
import { lineCommentKeymap } from "@domains/editor/utils/ui/lineCommentToggler";
import { reformatEditorView } from "@domains/editor/utils/formatting/formatter";
import { openEditorSearch } from "@domains/editor/utils/ui/search";
import {
  flattenRuns,
  visibleQueryRuns,
} from "@domains/results/components/RunHistoryChips/utils";
import { useGitStore } from "@domains/git/hooks";
import {
  openObjectDefinition,
} from "@domains/connection/components/CombinedConnectionsTree/hooks";
import {
  findSchemaNodeByPath,
  isDefinitionSupportedKind,
} from "@domains/connection/components/CombinedConnectionsTree/utils";
import { useSettingsStore } from "@shared/settings";
import type { KeymapAction } from "@shared/settings";
import { useAgentStore } from "@domains/agent/hooks";
import { useChartEditorStore } from "@domains/chart/hooks";
import { useCommandRegistryStore } from "../hooks/commandRegistryStore";
import { useFileSearchStore } from "@domains/files/hooks";
import { useTabsStore } from "../hooks/tabsStore";
import { openProjectFromMenu, pickAndOpenFolderInNewWindow } from "./app";

interface CommandSpec {
  run: () => void;
  isEnabled?: () => boolean;
}

// Registers a batch of command handlers for the lifetime of the calling
// component. Handlers re-read the latest closures every invocation (via a ref),
// so callers pass freshly-built specs each render without re-subscribing. The id
// set is expected to be stable per owner. When `active` is false the owner
// registers nothing, used so only the focused editor group owns the shared
// editor/tab command ids; a stale unregister never clobbers the new owner.
function useRegisterCommands(
  commands: Partial<Record<KeymapAction, CommandSpec>>,
  options?: { active?: boolean },
): void {
  const active = options?.active ?? true;
  const ref = useRef(commands);
  ref.current = commands;
  const ids = Object.keys(commands) as KeymapAction[];
  const idKey = ids.slice().sort().join(",");
  useEffect(() => {
    if (!active) return;
    const reg = useCommandRegistryStore.getState();
    const registered = ids.map((id) => {
      const handler = {
        run: () => ref.current[id]?.run(),
        isEnabled: () => ref.current[id]?.isEnabled?.() ?? true,
      };
      reg.register(id, handler);
      return [id, handler] as const;
    });
    return () => {
      const current = useCommandRegistryStore.getState();
      for (const [id, handler] of registered) current.unregister(id, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, active]);
}

function focusedEditor(): EditorView | null {
  const focused =
    (document.activeElement as HTMLElement | null)?.closest(".cm-editor") ??
    document.querySelector(".cm-editor");
  return focused ? EditorView.findFromDOM(focused as HTMLElement) : null;
}

function toggleLineComment(): void {
  const view = focusedEditor();
  if (!view) return;
  const languageId = (view.dom.dataset.arrisLang as string | undefined) ?? "sql";
  const bindings = lineCommentKeymap(languageId);
  bindings[0]?.run?.(view);
}

function reformatCode(): void {
  const view = focusedEditor();
  if (view) reformatEditorView(view);
}

function findInEditor(): void {
  const view = focusedEditor();
  if (view) openEditorSearch(view);
}

function replaceInEditor(): void {
  const view = focusedEditor();
  if (view) openEditorSearch(view, { replace: true });
}

// Cmd+W is pane-local. When the user last clicked inside the bottom Results
// pane, close the active run chip (the selected run, else the latest) instead of
// the editor's file tab. Falls back to closing the file tab when no chip exists.
function closeFocusedPaneTab(): void {
  if (useResultsTableStore.getState().bottomResultsFocused) {
    const runHistory = useRunHistoryStore.getState();
    const chips = visibleQueryRuns(flattenRuns(runHistory.runsByTab));
    const target = runHistory.selectedRunId
      ? chips.find((run) => run.id === runHistory.selectedRunId)
      : chips[chips.length - 1];
    if (target) {
      runHistory.removeRun(target.tabId, target.id);
      return;
    }
  }
  closeActiveTab();
}

function togglePinnedQueries(): void {
  const prefs = useSettingsStore.getState();
  // `togglePane`/`openPane` already close the chart editor and agent panel so
  // the right rail stays mutually exclusive.
  usePinnedQueriesStore.getState().togglePane();
  if (!prefs.sidebarRightVisible) prefs.toggleSidebarRightVisible();
}

function toggleChartEditor(): void {
  const chartEditor = useChartEditorStore.getState();
  if (chartEditor.targetTabId) {
    chartEditor.close();
    return;
  }
  // The chart editor edits the chart of a query result that is currently shown
  // as a chart, so it only opens when the active tab's results pane is in Chart
  // view (mirrors the status-bar button's disabled state).
  const activeId = useTabsStore.getState().activeId;
  if (!activeId) return;
  if (useResultsTableStore.getState().modeByTab[activeId] !== "chart") return;
  useAgentStore.getState().closePane();
  usePinnedQueriesStore.getState().closePane();
  chartEditor.open(activeId);
  if (!useSettingsStore.getState().sidebarRightVisible) {
    useSettingsStore.getState().toggleSidebarRightVisible();
  }
}

// Resolve the Connections-tree selection to its connection + schema node, but
// only when the node is a definition-supported object. Returns null otherwise
// (no selection, no connection, container node, or unsupported kind). Shared by
// the `showDefinition` command's `run` and `isEnabled`.
function resolveSelectedDefinitionObject() {
  const { selectedNodeId, selectedConnectionId } = useSchemaUiStore.getState();
  if (!selectedNodeId || !selectedConnectionId) return null;
  const { connections, schemaCache } = useConnectionsStore.getState();
  const connection = connections.find((c) => c.id === selectedConnectionId);
  if (!connection) return null;
  const node = findSchemaNodeByPath(schemaCache[selectedConnectionId] ?? [], selectedNodeId);
  if (!node || !isDefinitionSupportedKind(node.kind)) return null;
  return { connection, node };
}

function showObjectDefinition(): void {
  const resolved = resolveSelectedDefinitionObject();
  if (!resolved) return;
  void openObjectDefinition(resolved.connection, resolved.node).catch(() => {});
}

function toggleConnections(): void {
  const prefs = useSettingsStore.getState();
  const chartEditor = useChartEditorStore.getState();
  const pinnedStore = usePinnedQueriesStore.getState();
  const agentPanel = useAgentStore.getState();
  const switchingRightPane = !!chartEditor.targetTabId || pinnedStore.paneOpen || agentPanel.paneOpen;
  if (chartEditor.targetTabId) chartEditor.close();
  if (pinnedStore.paneOpen) pinnedStore.closePane();
  if (agentPanel.paneOpen) agentPanel.closePane();
  if (!prefs.sidebarRightVisible) {
    prefs.toggleSidebarRightVisible();
    return;
  }
  if (!switchingRightPane) prefs.toggleSidebarRightVisible();
}

function openAgentPanel(): void {
  const prefs = useSettingsStore.getState();
  if (useChartEditorStore.getState().targetTabId) useChartEditorStore.getState().close();
  usePinnedQueriesStore.getState().closePane();
  useAgentStore.getState().openPane();
  if (!prefs.sidebarRightVisible) prefs.toggleSidebarRightVisible();
}

function toggleAgentPanel(): void {
  if (useAgentStore.getState().paneOpen) {
    useAgentStore.getState().closePane();
    return;
  }
  openAgentPanel();
}

// Registers the app-level commands that don't depend on a single React
// component's local state: they operate on the focused editor or global
// stores. Always mounted with App, so these ids are always available; the
// keyboard shortcut and any menu/button invoke the same handler via runCommand.
function useGlobalCommands(): void {
  useRegisterCommands({
    runQuery: { run: () => executeActiveQuery("run") },
    stopQuery: { run: () => stopActiveQuery() },
    toggleLineComment: { run: toggleLineComment },
    reformatCode: { run: reformatCode },
    findInEditor: { run: findInEditor },
    replaceInEditor: { run: replaceInEditor },
    saveFile: { run: () => saveActiveFile() },
    aiGenerate: { run: openAgentPanel },
    openTab: { run: () => openNewConsoleTab() },
    closeTab: { run: closeFocusedPaneTab },
    openSettings: { run: () => useSettingsStore.getState().open() },
    searchFiles: { run: () => useFileSearchStore.getState().show("file") },
    searchContent: { run: () => useFileSearchStore.getState().show("content") },
    openProject: { run: () => { openProjectFromMenu().catch(() => {}); } },
    openProjectNewWindow: { run: () => { pickAndOpenFolderInNewWindow().catch(() => {}); } },
    toggleSidebar: { run: () => useSettingsStore.getState().toggleSidebarLeftVisible() },
    showProjectPane: { run: () => useSettingsStore.getState().setSidebarLeftTab("files") },
    showGitPane: {
      run: () => {
        useTabsStore.getState().openGitDiffTab();
        useSettingsStore.getState().setSidebarLeftTab("git");
      },
    },
    showAgentPanel: { run: toggleAgentPanel },
    showPinnedQueries: { run: togglePinnedQueries },
    showChartEditor: { run: toggleChartEditor },
    showConnections: { run: toggleConnections },
    showDefinition: {
      run: showObjectDefinition,
      isEnabled: () => resolveSelectedDefinitionObject() != null,
    },
    refreshSchema: {
      run: () => {
        const { selectedId, refreshSchema } = useConnectionsStore.getState();
        if (selectedId) refreshSchema(selectedId);
      },
      isEnabled: () => useConnectionsStore.getState().selectedId != null,
    },
    exportCsv: { run: () => exportActiveResults("csv") },
    exportJson: { run: () => exportActiveResults("json") },
    toggleTerminal: { run: () => useTabsStore.getState().openTerminalTab() },
    toggleRowDetail: { run: () => useSettingsStore.getState().toggleRowDetailPane() },
    gitStageAll: {
      run: () => void useGitStore.getState().stageAll(),
      isEnabled: () => useGitStore.getState().repoPath != null,
    },
    gitUnstageAll: {
      run: () => void useGitStore.getState().unstageAll(),
      isEnabled: () => useGitStore.getState().repoPath != null,
    },
    gitCommit: {
      run: () => void useGitStore.getState().commit(),
      isEnabled: () => useGitStore.getState().commitMessage.trim().length > 0,
    },
    gitPush: {
      run: () => void useGitStore.getState().push(),
      isEnabled: () => useGitStore.getState().hasRemote,
    },
    gitFetch: {
      run: () => void useGitStore.getState().fetch(),
      isEnabled: () => useGitStore.getState().hasRemote,
    },
    gitPull: {
      run: () => void useGitStore.getState().pull(),
      isEnabled: () => useGitStore.getState().hasUpstream,
    },
    gitShowHistory: {
      run: () => {
        useTabsStore.getState().openGitHistoryTab();
        useSettingsStore.getState().setSidebarLeftTab("git");
      },
    },
    gitResolveConflicts: {
      run: () => useTabsStore.getState().openGitConflictTab(),
      isEnabled: () => useGitStore.getState().mergeInProgress,
    },
  });
}

export { useGlobalCommands, useRegisterCommands };
