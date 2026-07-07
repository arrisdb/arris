import { useConnectionsStore } from "@domains/connection";
import { useFederationProgressStore, useResultsTableStore, useRunHistoryStore } from "@domains/results";
import { usePinnedQueriesStore } from "@domains/pinnedQueries";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import "./index.css";
import { findLeaf, findLeafWithTab, planTabDrop } from "@shell/utils/paneTree";
import { recordSelfWrite } from "@shell/utils/selfWrites";
import { useEditorHandleStore } from "../../hooks/editorHandleStore";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { useTransactionStore } from "../../hooks/transactionStore";
import type { EditorTab, PaneNode, PaneSplit, SplitDirection } from "@shell/types";
import {
  isRunnableQueryKind,
  kindForConnection,
  queryLanguageForEditorKind,
  shortcutDisplay,
  useRegisterCommands,
  zoomDirectionFromWheel,
  zoomEditor,
} from "@shell/utils";
import { useSettingsStore } from "@shared/settings";
import { useGitStore } from "@domains/git/hooks";
import { useFilesStore } from "@domains/files/hooks";
import { useDbtStore } from "@domains/dbt/hooks";
import type { DbtNode } from "@domains/dbt";
import { useSqlMeshStore } from "@domains/sqlmesh/hooks";
import type { SqlMeshModel } from "@domains/sqlmesh";
import type { AuxPane } from "./types";
import { ipcErrorMessage, type DiffHunk } from "@shared";
import {
  connectConnectionIPC,
  dbtBuildIPC,
  dbtCompileIPC,
  dbtDocsGenerateIPC,
  dbtDocsLoadIPC,
  dbtRunIPC,
  dbtTestIPC,
  gitFileDiffHunksIPC,
  gitRestoreChangeIPC,
  gitStageHunkIPC,
  listSchemasIPC,
  readTextFileIPC,
  runFederationQueryIPC,
  runQueryIPC,
  sqlmeshAuditIPC,
  sqlmeshLintIPC,
  sqlmeshPlanIPC,
  sqlmeshRenderIPC,
  sqlmeshRunIPC,
  sqlmeshTestIPC,
  sqlmeshTestTargetIPC,
  writeTextFileIPC,
} from "./ipc";
import { mountEditor, type EditorHandle } from "@domains/editor/utils/ui/setup";
import type { GitHunkActions } from "@domains/editor/utils/ui/gitGutter";
import { buildSourceColors } from "@domains/editor/utils/ui/sourceHighlight";
import { dbtDefinitionOffset, dbtDocRefForName, dbtMacroRefForName, dbtModelNodeForRef, dbtNodeCanContainRefs, dbtSourceNodeForRef, openDbtFile } from "@domains/dbt";
import { sqlmeshTestNameAtCursor } from "@domains/sqlmesh";
import { buildFederatedSqlSchema, buildSqlSchema, deriveSchemaScoping } from "@domains/editor/utils/autocomplete/sqlSchema";
import type { SqlSchemaDict } from "@domains/editor/utils/autocomplete/sqlSchema";
import { expandStarAtCursor, buildStarExpansionSchema, selectOutputColumns } from "@domains/editor/utils/navigation/expandStar";
import { TabBar } from "./components/TabBar";
import { tabIconName } from "./components/TabBar/utils";
import { TerminalView } from "@domains/terminal";
import { EditorTabRouter } from "./components/EditorTabRouter";
import type { MarkdownViewMode } from "../MarkdownPreview/types";
import { dbtSlimDiffIPC } from "./components/SlimDiff/ipc";
import type { DbtDiffRunConfig } from "./components/SlimDiff/types";
import { buildPreviewSql, discardLineRange, hunkInRange, resolveRunRange, resolveRunSql, resolveTabConnectionId, runErrorMessage, tabEqualIgnoringVolatile, tabsEqualIgnoringVolatile, NO_CONNECTION_MESSAGE } from "./utils";
import { AUTOSAVE_DEBOUNCE_MS, GIT_GUTTER_REFRESH_PAUSE_MS } from "./constants";
import { useStoreWithEqualityFn } from "zustand/traditional";

import { Icon } from "@shared/ui/Icon";
import {
  PaneContextMenuSurface,
  type ContextMenuItem,
  type PaneContextMenuItems,
  useContextMenu,
} from "@shared/ui/ContextMenu";
const queryEditorPaneContextMenuItems: PaneContextMenuItems<null> = () => [];

/// Droppable id prefix marking a whole pane group as a tab drop target (vs a
/// tab's own sortable id, which is the tab id).
const PANE_DROP_PREFIX = "panedrop:";

/// Which half of the target tab the cursor ended over. `closestCenter` only
/// tells us *which* tab is nearest, not whether the drop was on its left or
/// right half, so without this a drop on the right edge of a tab would still
/// insert to its left. Compares the dragged chip's centre to the target's.
function dropSide(e: DragEndEvent): "before" | "after" {
  const overRect = e.over?.rect;
  const activeRect = e.active.rect.current.translated;
  if (!overRect || !activeRect) return "before";
  const activeCenter = activeRect.left + activeRect.width / 2;
  const overCenter = overRect.left + overRect.width / 2;
  return activeCenter > overCenter ? "after" : "before";
}

/// Resolve a finished tab drag into store mutations: reorder within a pane, or
/// move the tab into another pane (placed before/after the tab it was dropped
/// on, depending on which half of that tab the cursor was over).
function applyTabDrop(e: DragEndEvent) {
  const { active, over } = e;
  if (!over) return;
  const tabId = String(active.id);
  const overId = String(over.id);
  const store = useTabsStore.getState();
  const target = overId.startsWith(PANE_DROP_PREFIX)
    ? { groupId: overId.slice(PANE_DROP_PREFIX.length) }
    : { tabId: overId };
  const side = dropSide(e);
  const plan = planTabDrop(store.layout, tabId, target, side);
  if (!plan) return;
  if (plan.type === "reorder") {
    store.reorderTabInGroup(plan.groupId, plan.from, plan.to);
    return;
  }
  store.moveTabToGroup(tabId, plan.targetGroupId);
  if (plan.toTabId) {
    // moveTabToGroup appends the tab to the end of the target group; slide it to
    // the drop position. The dragged tab is now last, so it always sits right of
    // the gap → destination is the gap index itself.
    const tgt = findLeafWithTab(useTabsStore.getState().layout, tabId);
    if (tgt) {
      const from = tgt.tabIds.indexOf(tabId);
      const overIndex = tgt.tabIds.indexOf(plan.toTabId);
      if (from >= 0 && overIndex >= 0) {
        const to = plan.side === "after" ? overIndex + 1 : overIndex;
        if (from !== to) store.reorderTabInGroup(tgt.id, from, to);
      }
    }
  }
}

function EditorPane() {
  const layout = useTabsStore((s) => s.layout);
  const addTab = useTabsStore((s) => s.addTab);
  const selectedConnectionId = useConnectionsStore((s) => s.selectedId);
  const connections = useConnectionsStore((s) => s.connections);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  // Stable null while no drag is active, and volatile-field churn (typing in
  // some pane) never re-renders the whole editor root mid-drag.
  const draggingTab = useStoreWithEqualityFn(
    useTabsStore,
    (s) => (draggingTabId ? s.tabs.find((t) => t.id === draggingTabId) ?? null : null),
    tabEqualIgnoringVolatile,
  );
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function onTabDragStart(e: DragStartEvent) {
    setDraggingTabId(String(e.active.id));
  }

  function onTabDragEnd(e: DragEndEvent) {
    setDraggingTabId(null);
    applyTabDrop(e);
  }

  function newTab() {
    const conn = connections.find((c) => c.id === selectedConnectionId);
    addTab({
      connectionId: conn?.id,
      kind: conn ? kindForConnection(conn.kind) : "sql",
    });
  }

  if (!layout) {
    return (
      <PaneContextMenuSurface
        context={null}
        getItems={queryEditorPaneContextMenuItems}
        className="mdbc-editor-empty"
      >
        <Icon name="terminal" size={32} color="var(--m-fg-3, #555)" />
        <span className="mdbc-editor-empty-label">Run a query now</span>
        <button
          onClick={newTab}
          className="mdbc-btn primary"
        >
          + New Console
        </button>
      </PaneContextMenuSurface>
    );
  }

  return (
    <PaneContextMenuSurface
      context={null}
      getItems={queryEditorPaneContextMenuItems}
      className="mdbc-editor-root"
    >
      <DndContext
        sensors={dndSensors}
        collisionDetection={closestCenter}
        onDragStart={onTabDragStart}
        onDragEnd={onTabDragEnd}
        onDragCancel={() => setDraggingTabId(null)}
      >
        <PaneTreeView node={layout} />
        {/* Render the dragged chip in a portal so it floats above all panes
            instead of being clipped by a pane's overflow. */}
        <DragOverlay dropAnimation={null}>
          {draggingTab ? <DragTabChip tab={draggingTab} /> : null}
        </DragOverlay>
      </DndContext>
    </PaneContextMenuSurface>
  );
}

/// Recursively render the pane layout tree: a split becomes a flex row/column
/// of its children (separated by a draggable `mdbc-pane-sep`), a leaf becomes a
/// pane.
function PaneTreeView({ node }: { node: PaneNode }) {
  if (node.kind === "leaf") {
    return <PaneGroupView groupId={node.id} />;
  }
  return <SplitView split={node} />;
}

/// Static copy of a tab chip shown inside the DragOverlay while a tab is being
/// dragged. Visually matches the `.mdbc-tab` in the bar.
function DragTabChip({ tab }: { tab: EditorTab }) {
  const icon = tabIconName(tab);
  return (
    <div className="mdbc-tab active dragging">
      {icon && (
        <span className="mdbc-tabbar-leading-icon">
          <Icon name={icon} size={11} />
        </span>
      )}
      <span>{tab.title}</span>
    </div>
  );
}

/// One split: lays its children out along `orientation`, each sized by its flex
/// fraction (`split.sizes`, defaulting to equal). The separators between panes
/// are drag handles that shift size between the two adjacent children.
function SplitView({ split }: { split: PaneSplit }) {
  const resizeSplit = useTabsStore((s) => s.resizeSplit);
  const containerRef = useRef<HTMLDivElement>(null);
  const n = split.children.length;
  const sizes =
    split.sizes && split.sizes.length === n
      ? split.sizes
      : Array<number>(n).fill(1 / n);

  // Drag the separator that sits before child `rightIndex`, trading size
  // between children `rightIndex - 1` and `rightIndex`.
  function onSeparatorMouseDown(rightIndex: number, e: React.MouseEvent) {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const horizontal = split.orientation === "row";
    const total = horizontal ? rect.width : rect.height;
    if (total <= 0) return;
    const startPos = horizontal ? e.clientX : e.clientY;
    const a = rightIndex - 1;
    const b = rightIndex;
    const startA = sizes[a];
    const startB = sizes[b];
    const pairSum = startA + startB;
    const minFrac = Math.min(0.1, pairSum / 2);

    function onMove(ev: MouseEvent) {
      const pos = horizontal ? ev.clientX : ev.clientY;
      const deltaFrac = (pos - startPos) / total;
      let nextA = startA + deltaFrac;
      if (nextA < minFrac) nextA = minFrac;
      if (nextA > pairSum - minFrac) nextA = pairSum - minFrac;
      const next = sizes.slice();
      next[a] = nextA;
      next[b] = pairSum - nextA;
      resizeSplit(split.id, next);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <div ref={containerRef} className={`mdbc-split ${split.orientation}`}>
      {split.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            <div
              className={`mdbc-pane-sep ${split.orientation}`}
              onMouseDown={(e) => onSeparatorMouseDown(i, e)}
            />
          )}
          <div
            className="mdbc-split-cell"
            style={{ "--mdbc-split-cell-grow": sizes[i] } as CSSProperties}
          >
            <PaneTreeView node={child} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

/// Per-group editor pane. All store reads are scoped to this group's tabs;
/// editor mount uses a pane-local ref so each pane keeps its own CodeMirror
/// instance without tearing during cross-pane focus changes.
function PaneGroupView({ groupId }: { groupId: string }) {
  const group = useTabsStore((s) => findLeaf(s.layout, groupId));
  // Ignore text/cursor/selection churn: typing writes those fields to the
  // store on every keystroke, and re-rendering this (large) component per key
  // was a dominant editor-latency cost. Everything render-visible here is
  // structural; the few consumers of the live buffer subscribe narrowly below
  // or read the store at invocation time (freshActiveTab).
  const allTabs = useStoreWithEqualityFn(
    useTabsStore,
    (s) => s.tabs,
    tabsEqualIgnoringVolatile,
  );
  const isFocusedGroup = useTabsStore((s) => s.focusedPaneGroupId === groupId);
  const updateTab = useTabsStore((s) => s.updateTab);
  const focusTab = useTabsStore((s) => s.focusTab);
  const focusGroup = useTabsStore((s) => s.focusGroup);
  const closeTab = useTabsStore((s) => s.closeTab);
  const splitTab = useTabsStore((s) => s.splitTab);
  // Whole pane is a tab drop target: dropping a dragged tab here moves it into
  // this group (the root DndContext resolves source vs target).
  const { setNodeRef: setDropRef, isOver: isDropOver } = useDroppable({
    id: `${PANE_DROP_PREFIX}${groupId}`,
  });
  const addTab = useTabsStore((s) => s.addTab);
  const openTerminalTab = useTabsStore((s) => s.openTerminalTab);
  const openUntitledNotebookTab = useTabsStore((s) => s.openUntitledNotebookTab);
  const openUntitledCanvasTab = useTabsStore((s) => s.openUntitledCanvasTab);
  const selectedConnectionId = useConnectionsStore((s) => s.selectedId);
  const selectConnection = useConnectionsStore((s) => s.selectConnection);
  const connections = useConnectionsStore((s) => s.connections);
  const schemaCache = useConnectionsStore((s) => s.schemaCache);
  const setSchema = useConnectionsStore((s) => s.setSchema);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const indentGuides = useSettingsStore((s) => s.indentGuides);
  const statementBorder = useSettingsStore((s) => s.statementBorder);
  const identifierCase = useSettingsStore((s) => s.formatter.sql.identifierCase);
  const autosave = useSettingsStore((s) => s.autosave);
  const keymapShortcuts = useSettingsStore((s) => s.shortcuts);
  const shortcut = (action: keyof typeof keymapShortcuts) =>
    shortcutDisplay(keymapShortcuts[action]) ?? undefined;
  const appendRun = useRunHistoryStore((s) => s.appendRun);
  const patchRun = useRunHistoryStore((s) => s.patchRun);
  const setRequestedPaneMode = useRunHistoryStore((s) => s.setRequestedPaneMode);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorHandleRef = useRef<EditorHandle | null>(null);
  /// Latest `runActiveTab` closure. The CodeMirror Mod-Enter binding is
  /// installed once per `mountEditor` call and would otherwise capture the
  /// initial closure (with stale `activeTab.text`). Reading through the ref
  /// lets the editor shortcut always trigger the current tab's run.
  const runActiveTabRef = useRef<() => void>(() => {});
  const saveActiveTabRef = useRef<() => void>(() => {});

  // Ctrl + wheel over the editor host zooms the editor font (passive: false so
  // we can suppress the browser's own page zoom).
  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) return undefined;
    const onWheel = (event: WheelEvent) => {
      const direction = zoomDirectionFromWheel(event);
      if (!direction) return;
      event.preventDefault();
      zoomEditor(direction);
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, []);

  // dbt state
  const dbtProject = useDbtStore((s) => s.project);
  const dbtNodesRaw = useDbtStore((s) => s.project?.nodes);
  const dbtNodes = useMemo(() => dbtNodesRaw ?? [], [dbtNodesRaw]);
  const compiledSql = useDbtStore((s) => s.compiledSql);
  const compiledStale = useDbtStore((s) => s.compiledStale);
  const compileErrors = useDbtStore((s) => s.compileErrors);
  const runningCommand = useDbtStore((s) => s.runningCommand);
  const setRunningCommand = useDbtStore((s) => s.setRunningCommand);
  const appendOutput = useDbtStore((s) => s.appendOutput);
  const setLastResult = useDbtStore((s) => s.setLastResult);
  const clearOutput = useDbtStore((s) => s.clearOutput);
  const setCompiledSql = useDbtStore((s) => s.setCompiledSql);
  const markCompiledStale = useDbtStore((s) => s.markCompiledStale);
  const setCompileError = useDbtStore((s) => s.setCompileError);
  const docs = useDbtStore((s) => s.docs);
  const docsStale = useDbtStore((s) => s.docsStale);
  const docsError = useDbtStore((s) => s.docsError);
  const setDocs = useDbtStore((s) => s.setDocs);
  const markDocsStale = useDbtStore((s) => s.markDocsStale);
  const setDocsError = useDbtStore((s) => s.setDocsError);
  const dbtBinaryPath = useDbtStore((s) => s.dbtBinaryPath);
  const dbtPickedConnectionId = useDbtStore((s) => s.pickedConnectionId);
  const dbtPickConnection = useDbtStore((s) => s.pickConnection);

  // One auxiliary view at a time: Compiled SQL, Docs, Lineage and sqlmesh
  // Rendered SQL share the slot beside the editor, so opening one closes the
  // rest. Child toolbars/panes keep their boolean props; these shims
  // map them onto the single `activeAux` selector.
  const [activeAux, setActiveAux] = useState<AuxPane>(null);
  const showCompiled = activeAux === "compiled";
  const showDocs = activeAux === "docs";
  const showLineage = activeAux === "lineage";
  const showRendered = activeAux === "rendered";
  const setShowCompiled = (open: boolean) => setActiveAux(open ? "compiled" : null);
  const setShowDocs = (open: boolean) => setActiveAux(open ? "docs" : null);
  const setShowRendered = (open: boolean) => setActiveAux(open ? "rendered" : null);
  const setShowLineage = (updater: (open: boolean) => boolean) =>
    setActiveAux((prev) => (updater(prev === "lineage") ? "lineage" : null));
  const showTransaction = activeAux === "transaction";
  const toggleTransaction = () => setActiveAux((prev) => (prev === "transaction" ? null : "transaction"));
  const [showDiffConfig, setShowDiffConfig] = useState(false);
  // Markdown tabs (.md) toggle between raw source, rendered preview and a
  // side-by-side split. Tracked per pane group; reset to raw on tab change.
  const [markdownView, setMarkdownView] = useState<MarkdownViewMode>("raw");

  const [isCompiling, setIsCompiling] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isDiffing, setIsDiffing] = useState(false);
  const [isGeneratingDocs, setIsGeneratingDocs] = useState(false);

  const groupTabs = useMemo(() => {
    if (!group) return [];
    const lookup = new Map(allTabs.map((t) => [t.id, t]));
    return group.tabIds
      .map((id) => lookup.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t);
  }, [group, allTabs]);

  const activeId = group?.selectedTabId ?? null;
  const activeTab = groupTabs.find((t) => t.id === activeId) ?? null;
  // The subscription above deliberately keeps text/cursor/selection stale in
  // render; any handler needing the live buffer reads it at invocation time.
  const freshActiveTab = () =>
    useTabsStore.getState().tabs.find((t) => t.id === activeId) ?? null;
  const isMarkdown = activeTab?.kind === "markdown";
  const showRunBar = isMarkdown || isRunnableQueryKind(activeTab?.kind);
  // Narrow live subscription: only a markdown tab needs its buffer text per
  // keystroke (live preview); every other tab kind returns a stable "" here.
  const markdownLiveText = useTabsStore((s) =>
    isMarkdown && activeId ? s.tabs.find((t) => t.id === activeId)?.text ?? "" : "",
  );

  // Status + start time of the active tab's most recent run, driving the
  // editor's per-statement run-status indicator (spinner / check / X).
  const activeRunStatus = useRunHistoryStore((s) =>
    activeId ? s.runsByTab[activeId]?.at(-1)?.status : undefined,
  );
  const activeRunStartedAt = useRunHistoryStore((s) =>
    activeId ? s.runsByTab[activeId]?.at(-1)?.startedAt : undefined,
  );

  useEffect(() => {
    setMarkdownView("raw");
  }, [activeId]);

  const currentDbtNode: DbtNode | null = useMemo(() => {
    if (!activeTab?.filePath || !dbtProject) return null;
    return dbtNodes.find((n) => n.filePath === activeTab.filePath) ?? null;
  }, [activeTab?.filePath, dbtNodes, dbtProject]);

  const isDbtModel = currentDbtNode?.kind === "model";
  const canResolveDbtRefs = dbtNodeCanContainRefs(currentDbtNode);

  // dbt selector text + the SplitButton's primary action live here (not inside
  // DbtToolbar) so keyboard shortcuts and toolbar clicks read/write the same
  // state. Reset to the node name / default action whenever the model changes.
  const [dbtSelector, setDbtSelector] = useState("");
  const [dbtPrimaryAction, setDbtPrimaryAction] = useState<string | null>(null);
  useEffect(() => {
    setDbtSelector(currentDbtNode?.name ?? "");
    setDbtPrimaryAction(null);
  }, [currentDbtNode?.name]);

  // sqlmesh state
  const sqlmeshProject = useSqlMeshStore((s) => s.project);
  const sqlmeshModels = useMemo(() => sqlmeshProject?.models ?? [], [sqlmeshProject]);
  const renderedSql = useSqlMeshStore((s) => s.renderedSql);
  const renderedStale = useSqlMeshStore((s) => s.renderedStale);
  const smRunningCommand = useSqlMeshStore((s) => s.runningCommand);
  const smSetRunningCommand = useSqlMeshStore((s) => s.setRunningCommand);
  const smAppendOutput = useSqlMeshStore((s) => s.appendOutput);
  const smSetLastResult = useSqlMeshStore((s) => s.setLastResult);
  const smClearOutput = useSqlMeshStore((s) => s.clearOutput);
  const setRenderedSql = useSqlMeshStore((s) => s.setRenderedSql);
  const markRenderedStale = useSqlMeshStore((s) => s.markRenderedStale);
  const renderErrors = useSqlMeshStore((s) => s.renderErrors);
  const setRenderError = useSqlMeshStore((s) => s.setRenderError);
  const sqlmeshBinaryPath = useSqlMeshStore((s) => s.sqlmeshBinaryPath);
  const sqlmeshEnvironment = useSqlMeshStore((s) => s.selectedEnvironment);

  const [isRendering, setIsRendering] = useState(false);

  const currentSqlMeshModel: SqlMeshModel | null = useMemo(() => {
    if (!activeTab?.filePath || !sqlmeshProject) return null;
    return sqlmeshModels.find((m) => m.filePath === activeTab.filePath) ?? null;
  }, [activeTab?.filePath, sqlmeshModels, sqlmeshProject]);

  const isSqlMeshModel = !!currentSqlMeshModel;
  // Python models have no renderable SQL: `sqlmesh render` returns a typed
  // all-NULL stub, so Preview (which runs the rendered SQL) can't show real
  // data. Gate it off; the materialized table is still browsable directly.
  const isSqlMeshPythonModel = currentSqlMeshModel?.kind === "python";

  // Freshest `.sql` for each project model, keyed by model name, read from disk
  // on project load, with any open editor buffer overlaid so un-saved edits win.
  // dbt/sqlmesh column intelligence (expand-all + autocomplete) parses these so a
  // newly added/edited column is reflected before any run/compile.
  const [modelDiskSql, setModelDiskSql] = useState<Record<string, string>>({});
  useEffect(() => {
    const files = isDbtModel
      ? dbtNodes.filter((n) => n.kind === "model" && n.filePath).map((n) => ({ name: n.name, filePath: n.filePath! }))
      : isSqlMeshModel
        ? sqlmeshModels.filter((m) => m.filePath).map((m) => ({ name: m.name, filePath: m.filePath! }))
        : [];
    if (files.length === 0) {
      setModelDiskSql({});
      return;
    }
    let cancelled = false;
    Promise.all(
      files.map(async (f) => {
        try {
          return [f.name, await readTextFileIPC(f.filePath)] as const;
        } catch {
          return [f.name, null] as const;
        }
      }),
    )
      .then((pairs) => {
        if (cancelled) return;
        setModelDiskSql(Object.fromEntries(pairs.filter((p) => p[1] != null) as [string, string][]));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isDbtModel, isSqlMeshModel, dbtNodes, sqlmeshModels]);

  // Subscribed with value equality (not identity): the map's content only
  // changes when a model file's buffer or disk copy changes, so plain-console
  // keystrokes neither re-render this component nor churn the identity chain
  // (liveModelSql -> liveModelColumns -> updateCompletionSchema effect), which
  // previously reconfigured the completion compartment on every keystroke.
  const liveModelSql = useStoreWithEqualityFn(
    useTabsStore,
    (s): Record<string, string> => {
      const pick = (name: string, filePath?: string) =>
        (filePath ? s.tabs.find((t) => t.filePath === filePath)?.text : undefined) ?? modelDiskSql[name];
      const map: Record<string, string> = {};
      const models = isDbtModel
        ? dbtNodes.filter((n) => n.kind === "model")
        : isSqlMeshModel
          ? sqlmeshModels
          : [];
      for (const m of models) {
        const sql = pick(m.name, m.filePath);
        if (sql != null) map[m.name] = sql;
      }
      return map;
    },
    (a, b) => {
      if (a === b) return true;
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      return ka.every((k) => a[k] === b[k]);
    },
  );

  // name → live `SELECT` output columns, parsed from `liveModelSql` when the
  // model SQL is confidently flat. Used to override stale scan columns in both
  // expand-all and the FROM-ref column autocomplete.
  const liveModelColumns = useMemo<Record<string, { name: string }[]>>(() => {
    const map: Record<string, { name: string }[]> = {};
    for (const [name, sql] of Object.entries(liveModelSql)) {
      const cols = selectOutputColumns(sql);
      if (cols) map[name] = cols.map((c) => ({ name: c }));
    }
    return map;
  }, [liveModelSql]);

  // sqlmesh selector text + the SplitButton's primary action live here (not in
  // SqlMeshToolbar) so keyboard shortcuts and toolbar clicks read/write the
  // same state. Reset to the model name / default action when the model
  // changes. Only `plan` consumes the selector; the rest run the bare name.
  const [smSelector, setSmSelector] = useState("");
  const [smPrimaryAction, setSmPrimaryAction] = useState<string | null>(null);
  useEffect(() => {
    setSmSelector(currentSqlMeshModel?.name ?? "");
    setSmPrimaryAction(null);
  }, [currentSqlMeshModel?.name]);

  // A test YAML matches no model filePath, so it gets its own toolbar. Detect
  // it by the scanned tests list, then resolve the test under the cursor for
  // the primary "Test" action (`sqlmesh test <file>::<name>`).
  const sqlmeshTests = useMemo(() => sqlmeshProject?.tests ?? [], [sqlmeshProject]);
  const isSqlMeshTestFile = useMemo(
    () =>
      !!activeTab?.filePath &&
      sqlmeshTests.some((t) => t.filePath === activeTab.filePath),
    [activeTab?.filePath, sqlmeshTests],
  );
  // Narrow live subscription: only a sqlmesh test YAML needs text/cursor per
  // keystroke (the toolbar's test-at-cursor label); every other tab kind
  // returns stable primitives here and skips the re-render.
  const smTestTabText = useTabsStore((s) =>
    isSqlMeshTestFile && activeId ? s.tabs.find((t) => t.id === activeId)?.text ?? "" : "",
  );
  const smTestTabCursor = useTabsStore((s) =>
    isSqlMeshTestFile && activeId ? s.tabs.find((t) => t.id === activeId)?.cursor ?? 0 : 0,
  );
  const currentSqlMeshTestName = useMemo(
    () => (isSqlMeshTestFile ? sqlmeshTestNameAtCursor(smTestTabText, smTestTabCursor) : null),
    [isSqlMeshTestFile, smTestTabText, smTestTabCursor],
  );

  function newTab() {
    focusGroup(groupId);
    const conn = connections.find((c) => c.id === selectedConnectionId);
    addTab({
      connectionId: conn?.id,
      kind: conn ? kindForConnection(conn.kind) : "sql",
    });
  }

  function newTerminalTab() {
    focusGroup(groupId);
    openTerminalTab();
  }

  function newNotebookTab() {
    focusGroup(groupId);
    openUntitledNotebookTab();
  }

  function newCanvasTab() {
    focusGroup(groupId);
    openUntitledCanvasTab(selectedConnectionId ?? undefined);
  }

  const tabConnectionId = resolveTabConnectionId({
    tabConnectionId: activeTab?.connectionId,
    isDbtNode: !!currentDbtNode,
    dbtPickedConnectionId,
    selectedConnectionId,
  });
  const tabConnection = connections.find((c) => c.id === tabConnectionId);
  const schemaNodes = tabConnectionId ? schemaCache[tabConnectionId] : undefined;

  function handleSelectConnection(connectionId: string) {
    if (!activeTab) return;
    const conn = connections.find((c) => c.id === connectionId);
    if (!conn) return;
    selectConnection(connectionId);
    if (currentDbtNode) {
      // The connection a dbt node runs against is a project-level choice, store
      // it on the dbt project so every model in the project inherits it, and drop
      // any per-tab override that would otherwise shadow the project pick.
      dbtPickConnection(connectionId);
      updateTab(activeTab.id, {
        connectionId: undefined,
        kind: kindForConnection(conn.kind),
        isFederation: false,
      });
      return;
    }
    updateTab(activeTab.id, {
      connectionId: connectionId,
      kind: kindForConnection(conn.kind),
      isFederation: false,
    });
  }
  function handleToggleFederation() {
    if (!activeTab) return;
    if (activeTab.isFederation) {
      // Restore the single-connection kind for the connection the tab kept
      // while federation was on, so toggling off returns to the prior selection.
      const conn = connections.find((c) => c.id === activeTab.connectionId);
      updateTab(activeTab.id, {
        isFederation: false,
        kind: conn ? kindForConnection(conn.kind) : "sql",
      });
    } else {
      // Keep connectionId so the selection survives a federation on/off toggle;
      // federation logic keys off isFederation, not connectionId.
      updateTab(activeTab.id, { isFederation: true, kind: "sql" });
    }
  }
  const sqlSchema = useMemo(
    () =>
      activeTab?.isFederation
        ? buildFederatedSqlSchema(
            connections.map((c) => ({ name: c.name, schema: schemaCache[c.id] })),
          )
        : schemaNodes
          ? buildSqlSchema(schemaNodes)
          : {},
    [activeTab?.isFederation, connections, schemaCache, schemaNodes],
  );
  // Federation always keeps the source-qualified form; a single connection's
  // scoping is derived from its schema tree (single vs multiple top-level
  // containers). Drives whether FROM suggestions drop the database/catalog prefix.
  const schemaScoping = useMemo(
    () =>
      activeTab?.isFederation
        ? { catalogQualified: true, schemaNames: [] as string[] }
        : schemaNodes
          ? deriveSchemaScoping(schemaNodes)
          : { catalogQualified: false, schemaNames: [] as string[] },
    [activeTab?.isFederation, schemaNodes],
  );
  const sourceColors = useMemo(
    () => (activeTab?.isFederation ? buildSourceColors(connections) : []),
    [activeTab?.isFederation, connections],
  );

  useEffect(() => {
    if (activeTab?.isFederation) {
      let cancelled = false;
      for (const conn of connections) {
        if (schemaCache[conn.id]) continue;
        connectConnectionIPC(conn.id)
          .then(() => listSchemasIPC(conn.id))
          .then((nodes) => {
            if (!cancelled) setSchema(conn.id, nodes);
          })
          .catch(() => {});
      }
      return () => {
        cancelled = true;
      };
    }
    if (!tabConnectionId) return;
    if (schemaCache[tabConnectionId]) return;
    let cancelled = false;
    connectConnectionIPC(tabConnectionId)
      .then(() => listSchemasIPC(tabConnectionId))
      .then((nodes) => {
        if (!cancelled) setSchema(tabConnectionId, nodes);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeTab?.isFederation, connections, tabConnectionId, schemaCache, setSchema]);

  const gitRepoPath = useGitStore((s) => s.repoPath);
  const [diffHunks, setDiffHunks] = useState<DiffHunk[]>([]);

  // Latest git context for the inline gutter Stage/Restore buttons. Kept in a
  // ref so the action callbacks (created once, captured by the editor at mount)
  // always read the current repo/file/tab instead of a stale closure.
  const gitHunkCtxRef = useRef<{
    repo: string | null;
    filePath?: string;
    tabId?: string;
    refreshToken?: number;
  }>({ repo: null });
  gitHunkCtxRef.current = {
    repo: gitRepoPath,
    filePath: activeTab?.filePath,
    tabId: activeTab?.id,
    refreshToken: activeTab?.refreshToken,
  };

  const diffHunkActions = useMemo<GitHunkActions>(() => {
    const refreshAfter = (repo: string, filePath: string) => {
      void useGitStore.getState().refreshFileStatuses().catch(() => {});
      gitFileDiffHunksIPC(repo, filePath)
        .then(setDiffHunks)
        .catch(() => setDiffHunks([]));
    };
    return {
      onStage: (hunkIndex) => {
        const { repo, filePath } = gitHunkCtxRef.current;
        if (!repo || !filePath) return;
        gitStageHunkIPC(repo, filePath, hunkIndex)
          .then(() => refreshAfter(repo, filePath))
          .catch((e) => console.error("Stage hunk failed", e));
      },
      onRestore: (startLine, endLine) => {
        const { repo, filePath, tabId, refreshToken } = gitHunkCtxRef.current;
        if (!repo || !filePath || !tabId) return;
        gitRestoreChangeIPC(repo, filePath, startLine, endLine)
          .then(async () => {
            // Restore rewrites the working file on disk; reload it into the tab
            // and bump refreshToken so the editor remounts with fresh content.
            const text = await readTextFileIPC(filePath).catch(() => null);
            if (text != null) {
              updateTab(tabId, { text, refreshToken: (refreshToken ?? 0) + 1 });
            }
            refreshAfter(repo, filePath);
          })
          .catch((e) => console.error("Restore hunk failed", e));
      },
    };
  }, [updateTab]);

  useEffect(() => {
    if (!activeTab?.filePath || !gitRepoPath) {
      setDiffHunks([]);
      return;
    }
    let cancelled = false;
    gitFileDiffHunksIPC(gitRepoPath, activeTab.filePath)
      .then((hunks) => { if (!cancelled) setDiffHunks(hunks); })
      .catch(() => { if (!cancelled) setDiffHunks([]); });
    return () => { cancelled = true; };
  }, [activeTab?.id, activeTab?.filePath, gitRepoPath]);

  useEffect(() => {
    if (!editorHostRef.current || !activeTab) return;
    // Seed from the live store, not the render-scope activeTab: text/cursor are
    // volatile fields kept stale in render, so a tab switch would otherwise
    // remount with pre-edit text and discard unsaved keystrokes.
    const seed = freshActiveTab() ?? activeTab;
    const handle = mountEditor({
      host: editorHostRef.current,
      initialDoc: seed.text,
      initialCursor: seed.cursor,
      initialScrollAnchor: seed.scrollAnchor,
      // One patch per editor update: a keystroke changes doc AND selection, so
      // separate callbacks meant three store writes (and three re-render waves
      // through every tab subscriber) per key. Single write instead.
      onEdit: (patch) => {
        updateTab(activeTab.id, patch);
        if (patch.text === undefined) return;
        if (currentDbtNode) {
          markCompiledStale(currentDbtNode.name);
          markDocsStale();
        }
        if (currentSqlMeshModel) markRenderedStale(currentSqlMeshModel.name);
      },
      onScroll: (anchor) => updateTab(activeTab.id, { scrollAnchor: anchor }),
      languageId: activeTab.kind,
      fileName: activeTab.filePath,
      connectionKind: tabConnection?.kind,
      schema: sqlSchema,
      schemaNames: schemaScoping.schemaNames,
      catalogQualified: schemaScoping.catalogQualified,
      identifierCase,
      sourceColors,
      fontSize: editorFontSize,
      indentGuides,
      statementBorder,
      onRun: () => runActiveTabRef.current(),
      onSave: () => saveActiveTabRef.current(),
      onContextMenuKey: () => openEditorMenuAtCaret(),
      onDbtRefClick: canResolveDbtRefs
        ? async (reference) => {
            const deps = {
              readTextFile: readTextFileIPC,
              openFileTab: useTabsStore.getState().openFileTab,
            };
            const cursorFor = (text: string) => dbtDefinitionOffset(text, reference);
            if (reference.kind === "ref") {
              const node = dbtModelNodeForRef(dbtNodes, reference.name);
              if (!node) return;
              focusGroup(groupId);
              await openDbtFile(node.filePath, deps);
              return;
            }
            if (reference.kind === "source") {
              const node = dbtSourceNodeForRef(dbtNodes, reference.sourceName, reference.tableName);
              if (!node) return;
              focusGroup(groupId);
              await openDbtFile(node.filePath, deps, cursorFor);
              return;
            }
            if (reference.kind === "macro") {
              const macro = dbtMacroRefForName(dbtProject?.macros ?? [], reference.name);
              if (!macro) return;
              focusGroup(groupId);
              await openDbtFile(macro.filePath, deps, cursorFor);
              return;
            }
            const doc = dbtDocRefForName(dbtProject?.docs ?? [], reference.name);
            if (!doc) return;
            focusGroup(groupId);
            await openDbtFile(doc.filePath, deps, cursorFor);
          }
        : undefined,
      diffHunks: activeTab.filePath ? diffHunks : undefined,
      diffHunkActions: activeTab.filePath ? diffHunkActions : undefined,
      dbtModels: isDbtModel ? dbtNodes.filter(n => n.kind === "model").map(n => ({
        name: n.name,
        columns: liveModelColumns[n.name] ?? n.columns,
      })) : undefined,
      dbtSources: isDbtModel ? dbtNodes.filter(n => n.kind === "source").map(n => ({
        sourceName: n.schema ?? n.name.split(".")[0] ?? "",
        tableName: n.name.split(".").pop() ?? n.name,
        columns: n.columns,
      })) : undefined,
      dbtMacros: isDbtModel ? (dbtProject?.macros ?? []).map(m => ({ name: m.name })) : undefined,
      sqlmeshModels: isSqlMeshModel ? sqlmeshModels.map(m => ({
        name: m.name,
        columns: liveModelColumns[m.name] ?? m.columns,
      })) : undefined,
    });
    editorHandleRef.current = handle;
    useEditorHandleStore.getState().setHandle(handle, activeTab?.id ?? null);
    return () => {
      // Remember the top row so switching back restores it instead of jumping
      // to the caret line on remount.
      updateTab(activeTab.id, { scrollAnchor: handle.getScrollAnchor() });
      editorHandleRef.current = null;
      useEditorHandleStore.getState().clearHandle();
      handle.destroy();
    };
  }, [activeTab?.id, activeTab?.kind, activeTab?.refreshToken, tabConnection?.kind, editorFontSize, indentGuides, statementBorder, isDbtModel, canResolveDbtRefs, dbtNodes]);

  // Reconfigure the editor's shortcut keymap when the user rebinds Run / Save /
  // Reformat / Line Comment in Settings, without remounting the editor.
  useEffect(() => {
    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (state.shortcuts !== prev.shortcuts) editorHandleRef.current?.updateShortcuts();
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    editorHandleRef.current?.updateCompletionSchema({
      schema: sqlSchema,
      schemaNames: schemaScoping.schemaNames,
      catalogQualified: schemaScoping.catalogQualified,
      identifierCase,
      connectionKind: tabConnection?.kind,
      dbtModels: isDbtModel ? dbtNodes.filter(n => n.kind === "model").map(n => ({
        name: n.name,
        columns: liveModelColumns[n.name] ?? n.columns,
      })) : undefined,
      dbtSources: isDbtModel ? dbtNodes.filter(n => n.kind === "source").map(n => ({
        sourceName: n.schema ?? n.name.split(".")[0] ?? "",
        tableName: n.name.split(".").pop() ?? n.name,
        columns: n.columns,
      })) : undefined,
      dbtMacros: isDbtModel ? (dbtProject?.macros ?? []).map(m => ({ name: m.name })) : undefined,
      sqlmeshModels: isSqlMeshModel ? sqlmeshModels.map(m => ({
        name: m.name,
        columns: liveModelColumns[m.name] ?? m.columns,
      })) : undefined,
    });
  }, [sqlSchema, tabConnection?.kind, identifierCase, isDbtModel, dbtNodes, isSqlMeshModel, sqlmeshModels, liveModelColumns]);

  useEffect(() => {
    editorHandleRef.current?.updateDiffHunks(activeTab?.filePath ? diffHunks : []);
  }, [diffHunks, activeTab?.filePath]);

  useEffect(() => {
    editorHandleRef.current?.updateSourceColors(sourceColors);
  }, [sourceColors]);

  // Push the executed statement's run status (spinner / check / X) onto the
  // editor. Anchored to runRange's start; persists until the next run replaces
  // it. Cleared when no run has happened in this tab yet.
  useEffect(() => {
    const handle = editorHandleRef.current;
    if (!handle) return;
    const range = activeTab?.runRange;
    if (!range) {
      handle.updateRunStatus(null);
      return;
    }
    if (activeTab?.isRunning) {
      handle.updateRunStatus({
        kind: "running",
        from: range.from,
        startedAt: activeRunStartedAt ?? Date.now(),
      });
    } else if (activeRunStatus === "success" || activeRunStatus === "error") {
      handle.updateRunStatus({ kind: activeRunStatus, from: range.from, startedAt: 0 });
    } else {
      handle.updateRunStatus(null);
    }
  }, [activeTab?.id, activeTab?.isRunning, activeTab?.runRange, activeRunStatus, activeRunStartedAt]);

  function runActiveTab() {
    // Live read: render-scope runTab has stale text/selection by design.
    const runTab = freshActiveTab();
    if (!runTab) return;
    const isFed = runTab.isFederation;
    // A table tab renders its rows inline and never uses the shared bottom
    // Results pane, so its run must leave that pane exactly as the user left it:
    // no expanding it, no switching its Command Logs/Results mode.
    const isTable = runTab.tabType === "table";
    const sql = resolveRunSql(runTab);
    if (!sql) return;
    const runId = crypto.randomUUID();
    const queryId = crypto.randomUUID();
    const startedAt = Date.now();
    appendRun(runTab.id, {
      id: runId,
      sqlSnapshot: sql,
      status: "pending",
      startedAt,
      connectionId: tabConnectionId ?? undefined,
    });
    if (!isTable) useSettingsStore.getState().showBottomPane();
    if (!isFed && (!tabConnectionId || !tabConnection)) {
      updateTab(runTab.id, { error: NO_CONNECTION_MESSAGE, isRunning: false });
      patchRun(runTab.id, runId, { status: "error", error: NO_CONNECTION_MESSAGE, endedAt: Date.now() });
      if (!isTable) setRequestedPaneMode("output");
      return;
    }
    updateTab(runTab.id, {
      isRunning: true,
      queryId,
      runRange: resolveRunRange(runTab),
      error: undefined,
      pane: "results",
    });
    const ps = useResultsTableStore.getState();
    ps.resetPage(runTab.id);
    const pSize = ps.getPageSize(runTab.id);
    const queryLanguage = queryLanguageForEditorKind(runTab.kind);
    // In manual transaction mode every executed statement leaves uncommitted
    // work, so the connection becomes dirty (enabling Commit/Rollback) and the
    // statement is recorded for the transaction reference pane.
    const isManualTx =
      !isFed &&
      !!tabConnectionId &&
      useTransactionStore.getState().configFor(tabConnectionId).mode === "manual";
    if (isFed) {
      useFederationProgressStore.getState().startRun();
    } else if (isManualTx && tabConnectionId) {
      useTransactionStore.getState().markDirty(tabConnectionId);
    }
    const queryPromise = isFed
      ? runFederationQueryIPC(sql, queryId)
      : runQueryIPC(tabConnectionId!, sql, [], queryLanguage, pSize, 0, queryId);
    queryPromise
      .then((result) => {
        if (isFed) useFederationProgressStore.getState().endRun();
        const isDml = result.rows_affected != null;
        updateTab(runTab.id, {
          result: isDml ? undefined : result,
          isRunning: false,
          plan: undefined,
          error: undefined,
          pane: "results",
        });
        patchRun(runTab.id, runId, {
          status: "success",
          result,
          endedAt: Date.now(),
        });
        if (isManualTx && tabConnectionId) {
          useTransactionStore.getState().recordStatement(tabConnectionId, {
            sql,
            status: "success",
            rowsAffected: result.rows_affected ?? null,
          });
        }
        if (isDml) {
          const allRuns = useRunHistoryStore.getState().runsByTab[runTab.id] ?? [];
          const lastSelect = [...allRuns].reverse().find(
            (r) => r.id !== runId && !/^\s*(INSERT|UPDATE|DELETE)\b/i.test(r.sqlSnapshot),
          );
          if (lastSelect) {
            useRunHistoryStore.getState().selectRun(lastSelect.id);
          }
        }
        if (!isTable) setRequestedPaneMode(isDml ? "output" : "results");
      })
      .catch((e) => {
        if (isFed) useFederationProgressStore.getState().endRun();
        const msg = runErrorMessage(e);
        updateTab(runTab.id, { error: msg, isRunning: false });
        patchRun(runTab.id, runId, {
          status: "error",
          error: msg,
          endedAt: Date.now(),
        });
        if (isManualTx && tabConnectionId) {
          useTransactionStore.getState().recordStatement(tabConnectionId, {
            sql,
            status: "error",
            rowsAffected: null,
            error: msg,
          });
        }
        if (!isTable) setRequestedPaneMode("output");
      });
  }

  function saveActiveTab() {
    // Live read: render-scope activeTab has stale text by design.
    const saveTab = freshActiveTab();
    // Media tabs are read-only binary previews; their `text` is empty, so
    // writing it back would truncate the image/asset on disk.
    if (!saveTab?.filePath || saveTab.tabType === "media") return;
    const filePath = saveTab.filePath;
    writeTextFileIPC(filePath, saveTab.text)
      .then(async () => {
        let repo = gitRepoPath;
        if (!repo) {
          repo = useFilesStore.getState().rootPath;
          if (repo) await useGitStore.getState().refreshFromRepo(repo).catch(() => {});
        } else {
          await useGitStore.getState().refreshFileStatuses().catch(() => {});
        }
        if (repo) {
          gitFileDiffHunksIPC(repo, filePath)
            .then(setDiffHunks)
            .catch(() => setDiffHunks([]));
        }
      })
      .catch((e) => console.error("Save failed", e));
  }

  useLayoutEffect(() => {
    runActiveTabRef.current = runActiveTab;
    saveActiveTabRef.current = saveActiveTab;
  });

  useEffect(() => {
    // Notebooks autosave themselves from the notebook store (tab.text is stale
    // for them), so skip them here. Media tabs are read-only binary previews:
    // their empty `text` would truncate the image/asset on disk.
    // Text changes are observed via a store subscription instead of a render
    // dependency so typing does not have to re-render this component to arm
    // the autosave debounce.
    if (
      !autosave ||
      !activeTab?.filePath ||
      activeTab.tabType === "notebook" ||
      activeTab.tabType === "media"
    )
      return;
    const filePath = activeTab.filePath;
    const tabId = activeTab.id;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let hunksTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useTabsStore.subscribe((state, prev) => {
      const next = state.tabs.find((t) => t.id === tabId);
      const before = prev.tabs.find((t) => t.id === tabId);
      if (!next || !before || next.text === before.text) return;
      if (timer) clearTimeout(timer);
      // A pending gutter redraw mid-typing is distracting; wait for a real pause.
      if (hunksTimer) clearTimeout(hunksTimer);
      timer = setTimeout(() => {
        // Mark the write so its watcher echo isn't mistaken for an external edit.
        const content = next.text;
        recordSelfWrite(filePath, content);
        writeTextFileIPC(filePath, content)
          .then(async () => {
            await useGitStore.getState().refreshFileStatuses().catch(() => {});
            const repo = gitRepoPath ?? useFilesStore.getState().rootPath;
            if (repo) {
              hunksTimer = setTimeout(() => {
                gitFileDiffHunksIPC(repo, filePath)
                  .then(setDiffHunks)
                  .catch(() => setDiffHunks([]));
              }, GIT_GUTTER_REFRESH_PAUSE_MS);
            }
          })
          .catch((e) => console.error("Autosave failed", e));
      }, AUTOSAVE_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      if (hunksTimer) clearTimeout(hunksTimer);
      unsubscribe();
    };
  }, [autosave, activeTab?.id, activeTab?.filePath, activeTab?.tabType, gitRepoPath]);


  function handleSplit(tabId: string, direction: SplitDirection) {
    splitTab(tabId, direction);
  }

  const editorMenu = useContextMenu<null>();
  // Position the "Expand all columns" detection at the right-click point rather
  // than the text caret; right-clicking doesn't move the caret, so otherwise
  // the user has to click the star first. Reset to the caret when no menu pos.
  const [ctxStarPos, setCtxStarPos] = useState<number | null>(null);
  // SELECT * expansion resolves the FROM target against the warehouse schema.
  // dbt/SQLMesh models select from `{{ ref(...) }}` / `{{ source(...) }}` whose
  // relations live in the project graph, not the warehouse dict, so fold their
  // live SQL columns in so star expansion works inside model files too.
  const starSchema = useMemo<SqlSchemaDict>(() => {
    const dbtArg = isDbtModel
      ? dbtNodes.map((n) => ({ name: n.name, kind: n.kind, columns: n.columns, sql: liveModelSql[n.name] }))
      : [];
    const sqlmeshArg = isSqlMeshModel
      ? sqlmeshModels.map((m) => ({ name: m.name, columns: m.columns, sql: liveModelSql[m.name] }))
      : [];
    return buildStarExpansionSchema(sqlSchema, dbtArg, sqlmeshArg);
  }, [isDbtModel, isSqlMeshModel, sqlSchema, dbtNodes, sqlmeshModels, liveModelSql]);
  // Prefer the right-click position (so right-clicking near a star offers the
  // action without first moving the caret), but fall back to the caret when the
  // click isn't on/near a star, preserving keyboard-placed-caret expansion.
  // Computed ON DEMAND (menu open / command dispatch), never per render: the
  // detection scans the whole document, and running it on every keystroke was
  // pure waste while the context menu stayed closed.
  const computeStarExpansion = (clickPos: number | null) => {
    const tab = freshActiveTab();
    if (!tab) return null;
    const fromClick =
      clickPos != null ? expandStarAtCursor(tab.text, clickPos, starSchema) : null;
    return fromClick ?? expandStarAtCursor(tab.text, tab.cursor ?? 0, starSchema);
  };
  // Menu open/close is a state change, so this render-scope value exists
  // exactly while the editor context menu is visible.
  const starExpansion = editorMenu.state ? computeStarExpansion(ctxStarPos) : null;

  function onEditorContextMenu(e: ReactMouseEvent) {
    const pos = editorHandleRef.current?.posAtCoords(e.clientX, e.clientY);
    setCtxStarPos(pos ?? null);
    editorMenu.open(e, null);
  }

  function onEditorContextMenuClose() {
    setCtxStarPos(null);
    editorMenu.close();
  }

  // Keyboard path (Option+Enter): pop the same editor context menu at the text
  // caret. Leaves `ctxStarPos` null so star detection falls back to the caret.
  function openEditorMenuAtCaret() {
    const coords = editorHandleRef.current?.getCursorCoords();
    if (!coords) return;
    setCtxStarPos(null);
    editorMenu.openAt(coords.left, coords.bottom, null);
  }

  function pinFocusedQuery() {
    const pinTab = freshActiveTab();
    if (!pinTab || !pinTab.text?.trim()) return;
    const sql = resolveRunSql(pinTab);
    if (!sql) return;
    const conn = connections.find((c) => c.id === pinTab.connectionId);
    const pinnedQueriesStore = usePinnedQueriesStore.getState();
    pinnedQueriesStore.addQuery({
      name: "Untitled query",
      text: sql,
      connectionId: pinTab.connectionId,
      kind: conn?.kind ?? "sql",
    });
    pinnedQueriesStore.openPane();
  }

  function reformatActiveEditor() {
    editorHandleRef.current?.reformat();
  }

  function expandFocusedStar() {
    // Menu path reuses the render-scope detection (right-click position);
    // the keyboard command path detects at the caret on demand.
    const expansion = starExpansion ?? computeStarExpansion(null);
    if (!expansion) return;
    editorHandleRef.current?.replaceRange(
      expansion.from,
      expansion.to,
      expansion.replacement,
    );
  }

  const editorCtxItems: ContextMenuItem[] = [
    {
      id: "reformat",
      label: "Reformat Codes",
      testId: "editor-ctx-reformat",
      action: reformatActiveEditor,
    },
    ...(starExpansion
      ? [{
          id: "expand-star",
          label: "Expand all columns",
          testId: "editor-ctx-expand-star",
          action: expandFocusedStar,
        } satisfies ContextMenuItem]
      : []),
    ...(activeTab?.tabType === "console"
      ? [{
          id: "pin-query",
          label: "Pin Query",
          testId: "editor-ctx-pin-query",
          action: pinFocusedQuery,
        } satisfies ContextMenuItem]
      : []),
  ];

  function handleRename(tabId: string, newTitle: string) {
    updateTab(tabId, { title: newTitle });
  }

  function switchMongoQueryMode(kind: "mongodb" | "mongoshell") {
    if (!activeTab || activeTab.kind === kind) return;
    updateTab(activeTab.id, {
      kind,
      error: undefined,
      refreshToken: (activeTab.refreshToken ?? 0) + 1,
    });
  }

  function switchEsQueryMode(kind: "elasticsearch" | "esrest") {
    if (!activeTab || activeTab.kind === kind) return;
    updateTab(activeTab.id, {
      kind,
      error: undefined,
      refreshToken: (activeTab.refreshToken ?? 0) + 1,
    });
  }

  function switchRedisQueryMode(kind: "redis" | "rediscli") {
    if (!activeTab || activeTab.kind === kind) return;
    updateTab(activeTab.id, {
      kind,
      error: undefined,
      refreshToken: (activeTab.refreshToken ?? 0) + 1,
    });
  }

  async function handleDbtRun(select?: string) {
    if (!currentDbtNode || !dbtProject) return;
    const sel = select ?? currentDbtNode.name;
    clearOutput();
    useSettingsStore.getState().showBottomPane();
    setRequestedPaneMode("output");
    appendOutput({ text: `> ${dbtBinaryPath || "dbt"} run --select ${sel}`, stream: "stdout", timestamp: Date.now() });
    setRunningCommand({ type: "run", select: sel, startedAt: Date.now(), sourceTab: activeTab ? { id: activeTab.id, title: activeTab.title } : undefined });
    try {
      const result = await dbtRunIPC(dbtProject.rootPath, sel, [], dbtBinaryPath);
      for (const line of result.stdout.split("\n")) {
        appendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
      }
      for (const line of result.stderr.split("\n").filter(Boolean)) {
        appendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
      }
      setLastResult({ exitCode: result.exitCode, durationMs: result.durationMs });
    } catch (e) {
      appendOutput({ text: String(e), stream: "stderr", timestamp: Date.now() });
      setLastResult({ exitCode: 1, durationMs: 0 });
    } finally {
      setRunningCommand(null);
    }
  }

  async function handleDbtTest(select?: string) {
    if (!currentDbtNode || !dbtProject) return;
    const sel = select ?? currentDbtNode.name;
    clearOutput();
    useSettingsStore.getState().showBottomPane();
    setRequestedPaneMode("output");
    appendOutput({ text: `> ${dbtBinaryPath || "dbt"} test --select ${sel}`, stream: "stdout", timestamp: Date.now() });
    setRunningCommand({ type: "test", select: sel, startedAt: Date.now(), sourceTab: activeTab ? { id: activeTab.id, title: activeTab.title } : undefined });
    try {
      const result = await dbtTestIPC(dbtProject.rootPath, sel, [], dbtBinaryPath);
      for (const line of result.stdout.split("\n")) {
        appendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
      }
      for (const line of result.stderr.split("\n").filter(Boolean)) {
        appendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
      }
      setLastResult({ exitCode: result.exitCode, durationMs: result.durationMs });
    } catch (e) {
      appendOutput({ text: String(e), stream: "stderr", timestamp: Date.now() });
      setLastResult({ exitCode: 1, durationMs: 0 });
    } finally {
      setRunningCommand(null);
    }
  }

  async function handleDbtBuild(select?: string) {
    if (!currentDbtNode || !dbtProject) return;
    const sel = select ?? currentDbtNode.name;
    clearOutput();
    useSettingsStore.getState().showBottomPane();
    setRequestedPaneMode("output");
    appendOutput({ text: `> ${dbtBinaryPath || "dbt"} build --select ${sel}`, stream: "stdout", timestamp: Date.now() });
    setRunningCommand({ type: "build", select: sel, startedAt: Date.now(), sourceTab: activeTab ? { id: activeTab.id, title: activeTab.title } : undefined });
    try {
      const result = await dbtBuildIPC(dbtProject.rootPath, sel, [], dbtBinaryPath);
      for (const line of result.stdout.split("\n")) {
        appendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
      }
      for (const line of result.stderr.split("\n").filter(Boolean)) {
        appendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
      }
      setLastResult({ exitCode: result.exitCode, durationMs: result.durationMs });
    } catch (e) {
      appendOutput({ text: String(e), stream: "stderr", timestamp: Date.now() });
      setLastResult({ exitCode: 1, durationMs: 0 });
    } finally {
      setRunningCommand(null);
    }
  }

  async function handleDbtCompile() {
    if (!currentDbtNode || !dbtProject) return;
    clearOutput();
    useSettingsStore.getState().showBottomPane();
    setRequestedPaneMode("output");
    appendOutput({ text: `> ${dbtBinaryPath || "dbt"} compile --select ${currentDbtNode.name}`, stream: "stdout", timestamp: Date.now() });
    setIsCompiling(true);
    setShowCompiled(true);
    setCompileError(currentDbtNode.name, false);
    setRunningCommand({ type: "compile", select: currentDbtNode.name, startedAt: Date.now(), sourceTab: activeTab ? { id: activeTab.id, title: activeTab.title } : undefined });
    try {
      const result = await dbtCompileIPC(dbtProject.rootPath, currentDbtNode.name, dbtProject.name, dbtBinaryPath);
      for (const line of result.stdout.split("\n")) {
        appendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
      }
      for (const line of result.stderr.split("\n").filter(Boolean)) {
        appendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
      }
      setLastResult({ exitCode: result.exitCode, durationMs: 0 });
      if (result.compiledSql) setCompiledSql(currentDbtNode.name, result.compiledSql);
      if (result.exitCode !== 0 || !result.compiledSql) setCompileError(currentDbtNode.name, true);
    } catch (e) {
      appendOutput({ text: `Compile failed: ${e}`, stream: "stderr", timestamp: Date.now() });
      setLastResult({ exitCode: 1, durationMs: 0 });
      setCompileError(currentDbtNode.name, true);
    } finally {
      setIsCompiling(false);
      setRunningCommand(null);
    }
  }

  // dbt Cloud-style preview: compile the model, then run its compiled SQL with
  // a row limit on the editor's active connection (the same one the Run button
  // uses) and stream rows into the Results tab.
  async function handleDbtPreview() {
    if (!currentDbtNode || !dbtProject || !isDbtModel || !activeTab) return;
    const tabId = activeTab.id;
    const model = currentDbtNode.name;
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    setIsPreviewing(true);
    // Log the run immediately (before the slow compile) so the command logs show
    // a running spinner from the moment Preview is clicked, like dbt run/build.
    // The placeholder label is swapped for the compiled SQL once it resolves.
    appendRun(tabId, { id: runId, sqlSnapshot: `dbt preview — ${model}`, status: "pending", startedAt, connectionId: tabConnectionId ?? undefined });
    useSettingsStore.getState().showBottomPane();
    // Show the command logs while compiling + querying; flip to Results only
    // once the preview query succeeds (mirrors the diff flow).
    setRequestedPaneMode("output");

    let compiled: string;
    try {
      const result = await dbtCompileIPC(dbtProject.rootPath, model, dbtProject.name, dbtBinaryPath);
      if (result.compiledSql) setCompiledSql(model, result.compiledSql);
      if (result.exitCode !== 0 || !result.compiledSql) {
        clearOutput();
        setRequestedPaneMode("output");
        for (const line of result.stderr.split("\n").filter(Boolean)) {
          appendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
        }
        appendOutput({ text: "Preview failed: model did not compile.", stream: "stderr", timestamp: Date.now() });
        patchRun(tabId, runId, { status: "error", error: "model did not compile", endedAt: Date.now() });
        setIsPreviewing(false);
        return;
      }
      compiled = result.compiledSql;
    } catch (e) {
      setRequestedPaneMode("output");
      appendOutput({ text: `Preview compile failed: ${e}`, stream: "stderr", timestamp: Date.now() });
      patchRun(tabId, runId, { status: "error", error: String(e), endedAt: Date.now() });
      setIsPreviewing(false);
      return;
    }

    const sql = buildPreviewSql(compiled);
    const queryId = crypto.randomUUID();
    // Replace the placeholder with the real preview SQL now that compile is done.
    patchRun(tabId, runId, { sqlSnapshot: sql });
    if (!tabConnectionId || !tabConnection) {
      updateTab(tabId, { error: NO_CONNECTION_MESSAGE, isRunning: false });
      patchRun(tabId, runId, { status: "error", error: NO_CONNECTION_MESSAGE, endedAt: Date.now() });
      setRequestedPaneMode("output");
      setIsPreviewing(false);
      return;
    }
    updateTab(tabId, { isRunning: true, queryId, error: undefined, pane: "results" });
    const ps = useResultsTableStore.getState();
    ps.resetPage(tabId);
    const pSize = ps.getPageSize(tabId);
    const language = queryLanguageForEditorKind(activeTab.kind);
    runQueryIPC(tabConnectionId, sql, [], language, pSize, 0, queryId)
      .then((result) => {
        updateTab(tabId, { result, isRunning: false, plan: undefined, error: undefined, pane: "results" });
        patchRun(tabId, runId, { status: "success", result, endedAt: Date.now() });
        setRequestedPaneMode("results");
      })
      .catch((e) => {
        const msg = runErrorMessage(e);
        updateTab(tabId, { error: msg, isRunning: false });
        patchRun(tabId, runId, { status: "error", error: msg, endedAt: Date.now() });
        // The output pane shows dbt command logs, not the tab's query error, so
        // surface the failure here too; otherwise a model whose upstreams are
        // not materialized fails the preview query with no visible feedback.
        appendOutput({ text: `Preview failed: ${msg}`, stream: "stderr", timestamp: Date.now() });
        setRequestedPaneMode("output");
      })
      .finally(() => setIsPreviewing(false));
  }

  // Slim-CI row diff: the connection comes from the tab, the backend compiles
  // the model and set-diffs its new output against the prod table. Recorded as
  // a run-history entry so it shows as a chip alongside query runs and lands in
  // the command logs (including failures).
  async function handleDbtDiff(config: DbtDiffRunConfig) {
    if (!currentDbtNode || !dbtProject || !isDbtModel || !activeTab || !tabConnectionId) return;
    const tabId = activeTab.id;
    const model = currentDbtNode.name;
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    const priorDiffs = useRunHistoryStore.getState().runsByTab[tabId] ?? [];
    const diffIndex = priorDiffs.filter((r) => r.diffModel).length + 1;
    setIsDiffing(true);
    useSettingsStore.getState().showBottomPane();
    appendRun(tabId, {
      id: runId,
      sqlSnapshot: `data diff — ${model} (${config.mode})`,
      status: "pending",
      startedAt,
      connectionId: tabConnectionId,
      logKind: "dbt",
      diffModel: model,
      diffIndex,
    });
    // Show the command logs while the diff runs (it streams progress there);
    // only flip to the Results pane once the diff actually succeeds.
    setRequestedPaneMode("output");
    setShowDiffConfig(false);
    try {
      // dbt compiles the model from disk, so flush the editor buffer first;
      // otherwise the diff reflects the last-saved file, not the latest edit.
      const diffTab = freshActiveTab();
      if (diffTab?.filePath) {
        await writeTextFileIPC(diffTab.filePath, diffTab.text);
      }
      const result = await dbtSlimDiffIPC({
        connectionId: tabConnectionId,
        root: dbtProject.rootPath,
        model,
        projectName: dbtProject.name,
        mode: config.mode,
        sampleSize: config.sampleSize,
        keyColumns: config.keyColumns,
        dbtBinary: dbtBinaryPath || undefined,
      });
      patchRun(tabId, runId, { status: "success", diffResult: result, endedAt: Date.now() });
      setRequestedPaneMode("results");
    } catch (e) {
      patchRun(tabId, runId, { status: "error", error: ipcErrorMessage(e), endedAt: Date.now() });
      setRequestedPaneMode("output");
    } finally {
      setIsDiffing(false);
    }
  }

  async function regenerateDocs() {
    if (!dbtProject) return;
    clearOutput();
    useSettingsStore.getState().showBottomPane();
    setRequestedPaneMode("output");
    appendOutput({ text: `> ${dbtBinaryPath || "dbt"} docs generate`, stream: "stdout", timestamp: Date.now() });
    setIsGeneratingDocs(true);
    setDocsError(false);
    // Route through the command-log lifecycle so `dbt docs generate` lands in
    // the Command Logs pane with status + duration, like run/test/build/compile.
    setRunningCommand({ type: "docs", select: "", startedAt: Date.now(), sourceTab: activeTab ? { id: activeTab.id, title: activeTab.title } : undefined });
    try {
      const result = await dbtDocsGenerateIPC(dbtProject.rootPath, [], dbtBinaryPath);
      for (const line of result.stdout.split("\n")) {
        appendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
      }
      for (const line of result.stderr.split("\n").filter(Boolean)) {
        appendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
      }
      setLastResult({ exitCode: result.exitCode, durationMs: result.durationMs });
      if (result.exitCode === 0) {
        const loaded = await dbtDocsLoadIPC(dbtProject.rootPath);
        setDocs(loaded);
      } else {
        setDocsError(true);
      }
    } catch (e) {
      appendOutput({ text: `Docs generate failed: ${e}`, stream: "stderr", timestamp: Date.now() });
      setLastResult({ exitCode: 1, durationMs: 0 });
      setDocsError(true);
    } finally {
      setIsGeneratingDocs(false);
      setRunningCommand(null);
    }
  }

  function handleDbtDocs() {
    if (!currentDbtNode || !dbtProject) return;
    if (showDocs) {
      setShowDocs(false);
      return;
    }
    setShowDocs(true);
    // Regenerate when docs are absent or a model file changed since last build.
    if (!docs || docsStale) regenerateDocs();
  }

  async function handleSmPlan(select: string) {
    if (!currentSqlMeshModel || !sqlmeshProject) return;
    smClearOutput();
    useSettingsStore.getState().showBottomPane();
    setRequestedPaneMode("output");
    const envArg = sqlmeshEnvironment ? `${sqlmeshEnvironment} ` : "";
    smAppendOutput({ text: `> ${sqlmeshBinaryPath || "sqlmesh"} plan ${envArg}--select-model ${select}`, stream: "stdout", timestamp: Date.now() });
    smSetRunningCommand({ type: "plan", select, startedAt: Date.now(), sourceTab: activeTab ? { id: activeTab.id, title: activeTab.title } : undefined });
    try {
      const result = await sqlmeshPlanIPC(sqlmeshProject.rootPath, select, sqlmeshEnvironment, [], sqlmeshBinaryPath);
      for (const line of result.stdout.split("\n")) {
        smAppendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
      }
      for (const line of result.stderr.split("\n").filter(Boolean)) {
        smAppendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
      }
      smSetLastResult({ exitCode: result.exitCode, durationMs: result.durationMs });
    } catch (e) {
      smAppendOutput({ text: String(e), stream: "stderr", timestamp: Date.now() });
      smSetLastResult({ exitCode: 1, durationMs: 0 });
    } finally {
      smSetRunningCommand(null);
    }
  }

  async function handleSmTest() {
    if (!currentSqlMeshModel || !sqlmeshProject) return;
    smClearOutput();
    useSettingsStore.getState().showBottomPane();
    setRequestedPaneMode("output");
    smAppendOutput({ text: `> ${sqlmeshBinaryPath || "sqlmesh"} test (model: ${currentSqlMeshModel.name})`, stream: "stdout", timestamp: Date.now() });
    smSetRunningCommand({ type: "test", select: currentSqlMeshModel.name, startedAt: Date.now(), sourceTab: activeTab ? { id: activeTab.id, title: activeTab.title } : undefined });
    try {
      const result = await sqlmeshTestIPC(sqlmeshProject.rootPath, currentSqlMeshModel.name, [], sqlmeshBinaryPath);
      for (const line of result.stdout.split("\n")) {
        smAppendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
      }
      for (const line of result.stderr.split("\n").filter(Boolean)) {
        smAppendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
      }
      smSetLastResult({ exitCode: result.exitCode, durationMs: result.durationMs });
    } catch (e) {
      smAppendOutput({ text: String(e), stream: "stderr", timestamp: Date.now() });
      smSetLastResult({ exitCode: 1, durationMs: 0 });
    } finally {
      smSetRunningCommand(null);
    }
  }

  // `sqlmesh run [--select-model <selector>]`. Mirrors Plan: an empty selector
  // runs the whole project; a non-empty one targets that model (and upstream).
  async function handleSmRun(select: string) {
    if (!currentSqlMeshModel || !sqlmeshProject) return;
    smClearOutput();
    useSettingsStore.getState().showBottomPane();
    setRequestedPaneMode("output");
    const args = select ? ["--select-model", select] : [];
    smAppendOutput({ text: `> ${sqlmeshBinaryPath || "sqlmesh"} run${select ? ` --select-model ${select}` : ""}`, stream: "stdout", timestamp: Date.now() });
    smSetRunningCommand({ type: "run", select, startedAt: Date.now(), sourceTab: activeTab ? { id: activeTab.id, title: activeTab.title } : undefined });
    try {
      const result = await sqlmeshRunIPC(sqlmeshProject.rootPath, args, sqlmeshBinaryPath);
      for (const line of result.stdout.split("\n")) {
        smAppendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
      }
      for (const line of result.stderr.split("\n").filter(Boolean)) {
        smAppendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
      }
      smSetLastResult({ exitCode: result.exitCode, durationMs: result.durationMs });
    } catch (e) {
      smAppendOutput({ text: String(e), stream: "stderr", timestamp: Date.now() });
      smSetLastResult({ exitCode: 1, durationMs: 0 });
    } finally {
      smSetRunningCommand(null);
    }
  }

  // `sqlmesh lint --model <name>`: runs the linter against the active model.
  async function handleSmLint() {
    if (!currentSqlMeshModel || !sqlmeshProject) return;
    smClearOutput();
    useSettingsStore.getState().showBottomPane();
    setRequestedPaneMode("output");
    smAppendOutput({ text: `> ${sqlmeshBinaryPath || "sqlmesh"} lint --model ${currentSqlMeshModel.name}`, stream: "stdout", timestamp: Date.now() });
    smSetRunningCommand({ type: "lint", select: currentSqlMeshModel.name, startedAt: Date.now(), sourceTab: activeTab ? { id: activeTab.id, title: activeTab.title } : undefined });
    try {
      const result = await sqlmeshLintIPC(sqlmeshProject.rootPath, currentSqlMeshModel.name, [], sqlmeshBinaryPath);
      for (const line of result.stdout.split("\n")) {
        smAppendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
      }
      for (const line of result.stderr.split("\n").filter(Boolean)) {
        smAppendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
      }
      smSetLastResult({ exitCode: result.exitCode, durationMs: result.durationMs });
    } catch (e) {
      smAppendOutput({ text: String(e), stream: "stderr", timestamp: Date.now() });
      smSetLastResult({ exitCode: 1, durationMs: 0 });
    } finally {
      smSetRunningCommand(null);
    }
  }

  // `sqlmesh audit --model <name>`: runs the audits declared on the active
  // model (SQLMesh's model-validation command).
  async function handleSmAudit() {
    if (!currentSqlMeshModel || !sqlmeshProject) return;
    smClearOutput();
    useSettingsStore.getState().showBottomPane();
    setRequestedPaneMode("output");
    smAppendOutput({ text: `> ${sqlmeshBinaryPath || "sqlmesh"} audit --model ${currentSqlMeshModel.name}`, stream: "stdout", timestamp: Date.now() });
    smSetRunningCommand({ type: "audit", select: currentSqlMeshModel.name, startedAt: Date.now(), sourceTab: activeTab ? { id: activeTab.id, title: activeTab.title } : undefined });
    try {
      const result = await sqlmeshAuditIPC(sqlmeshProject.rootPath, currentSqlMeshModel.name, [], sqlmeshBinaryPath);
      for (const line of result.stdout.split("\n")) {
        smAppendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
      }
      for (const line of result.stderr.split("\n").filter(Boolean)) {
        smAppendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
      }
      smSetLastResult({ exitCode: result.exitCode, durationMs: result.durationMs });
    } catch (e) {
      smAppendOutput({ text: String(e), stream: "stderr", timestamp: Date.now() });
      smSetLastResult({ exitCode: 1, durationMs: 0 });
    } finally {
      smSetRunningCommand(null);
    }
  }

  async function handleSmTestTarget(target: string, label: string) {
    if (!sqlmeshProject) return;
    smClearOutput();
    useSettingsStore.getState().showBottomPane();
    setRequestedPaneMode("output");
    smAppendOutput({ text: `> ${sqlmeshBinaryPath || "sqlmesh"} test ${label}`, stream: "stdout", timestamp: Date.now() });
    smSetRunningCommand({ type: "test", select: label, startedAt: Date.now(), sourceTab: activeTab ? { id: activeTab.id, title: activeTab.title } : undefined });
    try {
      const result = await sqlmeshTestTargetIPC(sqlmeshProject.rootPath, target, [], sqlmeshBinaryPath);
      for (const line of result.stdout.split("\n")) {
        smAppendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
      }
      for (const line of result.stderr.split("\n").filter(Boolean)) {
        smAppendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
      }
      smSetLastResult({ exitCode: result.exitCode, durationMs: result.durationMs });
    } catch (e) {
      smAppendOutput({ text: String(e), stream: "stderr", timestamp: Date.now() });
      smSetLastResult({ exitCode: 1, durationMs: 0 });
    } finally {
      smSetRunningCommand(null);
    }
  }

  function handleSmTestAtCursor() {
    const testTab = freshActiveTab();
    if (!testTab?.filePath) return;
    const name = sqlmeshTestNameAtCursor(testTab.text, testTab.cursor ?? 0);
    const target = name ? `${testTab.filePath}::${name}` : testTab.filePath;
    void handleSmTestTarget(target, name ?? testTab.title);
  }

  function handleSmTestFile() {
    if (!activeTab?.filePath) return;
    void handleSmTestTarget(activeTab.filePath, activeTab.title);
  }

  async function handleSmRender() {
    if (!currentSqlMeshModel || !sqlmeshProject) return;
    smClearOutput();
    useSettingsStore.getState().showBottomPane();
    setRequestedPaneMode("output");
    smAppendOutput({ text: `> ${sqlmeshBinaryPath || "sqlmesh"} render ${currentSqlMeshModel.name}`, stream: "stdout", timestamp: Date.now() });
    setIsRendering(true);
    setShowRendered(true);
    smSetRunningCommand({ type: "render", select: currentSqlMeshModel.name, startedAt: Date.now(), sourceTab: activeTab ? { id: activeTab.id, title: activeTab.title } : undefined });
    try {
      const result = await sqlmeshRenderIPC(sqlmeshProject.rootPath, currentSqlMeshModel.name, sqlmeshBinaryPath);
      for (const line of result.stdout.split("\n")) {
        smAppendOutput({ text: line, stream: "stdout", timestamp: Date.now() });
      }
      for (const line of result.stderr.split("\n").filter(Boolean)) {
        smAppendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
      }
      smSetLastResult({ exitCode: result.exitCode, durationMs: 0 });
      if (result.renderedSql) {
        // setRenderedSql clears any prior render error for this model.
        setRenderedSql(currentSqlMeshModel.name, result.renderedSql);
      } else {
        setRenderError(currentSqlMeshModel.name, true);
      }
    } catch (e) {
      smAppendOutput({ text: `Render failed: ${e}`, stream: "stderr", timestamp: Date.now() });
      smSetLastResult({ exitCode: 1, durationMs: 0 });
      setRenderError(currentSqlMeshModel.name, true);
    } finally {
      setIsRendering(false);
      smSetRunningCommand(null);
    }
  }

  // sqlmesh equivalent of the dbt Preview: render the model, then run its
  // rendered SQL with a row limit on the editor's active connection and stream
  // rows into the Results tab. No `sqlmesh run` needed first.
  async function handleSmPreview() {
    if (!currentSqlMeshModel || !sqlmeshProject || !isSqlMeshModel || !activeTab) return;
    if (isSqlMeshPythonModel) return;
    setIsPreviewing(true);
    let rendered: string;
    try {
      const result = await sqlmeshRenderIPC(sqlmeshProject.rootPath, currentSqlMeshModel.name, sqlmeshBinaryPath);
      if (result.renderedSql) setRenderedSql(currentSqlMeshModel.name, result.renderedSql);
      if (result.exitCode !== 0 || !result.renderedSql) {
        smClearOutput();
        useSettingsStore.getState().showBottomPane();
        setRequestedPaneMode("output");
        for (const line of result.stderr.split("\n").filter(Boolean)) {
          smAppendOutput({ text: line, stream: "stderr", timestamp: Date.now() });
        }
        smAppendOutput({ text: "Preview failed: model did not render.", stream: "stderr", timestamp: Date.now() });
        setIsPreviewing(false);
        return;
      }
      rendered = result.renderedSql;
    } catch (e) {
      useSettingsStore.getState().showBottomPane();
      setRequestedPaneMode("output");
      smAppendOutput({ text: `Preview render failed: ${e}`, stream: "stderr", timestamp: Date.now() });
      setIsPreviewing(false);
      return;
    }

    const sql = buildPreviewSql(rendered);
    const tabId = activeTab.id;
    const runId = crypto.randomUUID();
    const queryId = crypto.randomUUID();
    const startedAt = Date.now();
    appendRun(tabId, { id: runId, sqlSnapshot: sql, status: "pending", startedAt, connectionId: tabConnectionId ?? undefined });
    useSettingsStore.getState().showBottomPane();
    if (!tabConnectionId || !tabConnection) {
      updateTab(tabId, { error: NO_CONNECTION_MESSAGE, isRunning: false });
      patchRun(tabId, runId, { status: "error", error: NO_CONNECTION_MESSAGE, endedAt: Date.now() });
      setRequestedPaneMode("output");
      setIsPreviewing(false);
      return;
    }
    updateTab(tabId, { isRunning: true, queryId, error: undefined, pane: "results" });
    const ps = useResultsTableStore.getState();
    ps.resetPage(tabId);
    const pSize = ps.getPageSize(tabId);
    const language = queryLanguageForEditorKind(activeTab.kind);
    runQueryIPC(tabConnectionId, sql, [], language, pSize, 0, queryId)
      .then((result) => {
        updateTab(tabId, { result, isRunning: false, plan: undefined, error: undefined, pane: "results" });
        patchRun(tabId, runId, { status: "success", result, endedAt: Date.now() });
        setRequestedPaneMode("results");
      })
      .catch((e) => {
        const msg = runErrorMessage(e);
        updateTab(tabId, { error: msg, isRunning: false });
        patchRun(tabId, runId, { status: "error", error: msg, endedAt: Date.now() });
        setRequestedPaneMode("output");
      })
      .finally(() => setIsPreviewing(false));
  }

  // Every deterministic editor/tab/dbt/sqlmesh action is a command owned by the
  // focused editor group. The keyboard shortcut and the matching toolbar
  // button/menu item both invoke the same handler through the command registry.
  // Applicability is gated per-command via isEnabled; only the focused group
  // registers (active flag), so split panes never contend for a command id.
  const isMongoTab = activeTab?.kind === "mongodb" || activeTab?.kind === "mongoshell";
  const isEsTab = activeTab?.kind === "elasticsearch" || activeTab?.kind === "esrest";
  const isRedisTab = activeTab?.kind === "redis" || activeTab?.kind === "rediscli";
  const dbtModelReady = isDbtModel && !!currentDbtNode;
  const sqlMeshModelReady = isSqlMeshModel && !!currentSqlMeshModel;
  useRegisterCommands(
    {
      dbtRun: { run: () => { setDbtPrimaryAction("run"); handleDbtRun(dbtSelector); }, isEnabled: () => dbtModelReady },
      dbtTest: { run: () => { setDbtPrimaryAction("test"); handleDbtTest(dbtSelector); }, isEnabled: () => dbtModelReady },
      dbtBuild: { run: () => { setDbtPrimaryAction("build"); handleDbtBuild(dbtSelector); }, isEnabled: () => dbtModelReady },
      dbtCompile: { run: () => { setDbtPrimaryAction("compile"); handleDbtCompile(); }, isEnabled: () => dbtModelReady },
      dbtDocs: { run: () => { setDbtPrimaryAction("docs"); handleDbtDocs(); }, isEnabled: () => dbtModelReady },
      dbtLineage: { run: () => { setDbtPrimaryAction("lineage"); setShowLineage((v) => !v); }, isEnabled: () => !!currentDbtNode },
      dbtPreview: { run: () => { setDbtPrimaryAction("preview"); handleDbtPreview(); }, isEnabled: () => dbtModelReady },
      dbtDiff: { run: () => { setDbtPrimaryAction("diff"); setShowDiffConfig((v) => !v); }, isEnabled: () => dbtModelReady },
      sqlmeshPlan: { run: () => { setSmPrimaryAction("plan"); handleSmPlan(smSelector); }, isEnabled: () => sqlMeshModelReady },
      sqlmeshRun: { run: () => { setSmPrimaryAction("run"); handleSmRun(smSelector); }, isEnabled: () => sqlMeshModelReady },
      sqlmeshTest: { run: () => { setSmPrimaryAction("test"); handleSmTest(); }, isEnabled: () => sqlMeshModelReady },
      sqlmeshRender: { run: () => { setSmPrimaryAction("render"); handleSmRender(); }, isEnabled: () => sqlMeshModelReady },
      sqlmeshLint: { run: () => { setSmPrimaryAction("lint"); handleSmLint(); }, isEnabled: () => sqlMeshModelReady },
      sqlmeshAudit: { run: () => { setSmPrimaryAction("audit"); handleSmAudit(); }, isEnabled: () => sqlMeshModelReady },
      sqlmeshLineage: { run: () => { setSmPrimaryAction("lineage"); setShowLineage((v) => !v); }, isEnabled: () => sqlMeshModelReady },
      sqlmeshPreview: {
        run: () => { setSmPrimaryAction("preview"); handleSmPreview(); },
        isEnabled: () => sqlMeshModelReady && !isSqlMeshPythonModel,
      },
      expandStar: {
        run: () => expandFocusedStar(),
        isEnabled: () => !!(starExpansion ?? computeStarExpansion(null)),
      },
      pinQuery: { run: () => pinFocusedQuery(), isEnabled: () => activeTab?.tabType === "console" },
      openEditorContextMenu: { run: () => openEditorMenuAtCaret(), isEnabled: () => !!activeTab },
      switchMongoSqlMode: { run: () => switchMongoQueryMode("mongodb"), isEnabled: () => isMongoTab },
      switchMongoShellMode: { run: () => switchMongoQueryMode("mongoshell"), isEnabled: () => isMongoTab },
      switchEsSqlMode: { run: () => switchEsQueryMode("elasticsearch"), isEnabled: () => isEsTab },
      switchEsRestMode: { run: () => switchEsQueryMode("esrest"), isEnabled: () => isEsTab },
      switchRedisSqlMode: { run: () => switchRedisQueryMode("redis"), isEnabled: () => isRedisTab },
      switchRedisCliMode: { run: () => switchRedisQueryMode("rediscli"), isEnabled: () => isRedisTab },
      splitRight: { run: () => { if (activeTab) handleSplit(activeTab.id, "right"); }, isEnabled: () => !!activeTab },
      splitLeft: { run: () => { if (activeTab) handleSplit(activeTab.id, "left"); }, isEnabled: () => !!activeTab },
      splitTop: { run: () => { if (activeTab) handleSplit(activeTab.id, "up"); }, isEnabled: () => !!activeTab },
      splitBottom: { run: () => { if (activeTab) handleSplit(activeTab.id, "down"); }, isEnabled: () => !!activeTab },
      gitDiscardHunk: {
        run: () => {
          const tab = freshActiveTab();
          if (!tab?.filePath) return;
          const { startLine, endLine } = discardLineRange(tab.text ?? "", tab.cursor ?? 0, tab.selection);
          if (hunkInRange(diffHunks, startLine, endLine)) diffHunkActions.onRestore(startLine, endLine);
        },
        isEnabled: () => !!activeTab?.filePath && diffHunks.length > 0,
      },
      newTerminalTab: { run: () => newTerminalTab() },
      newNotebookTab: { run: () => newNotebookTab() },
      newCanvasTab: { run: () => newCanvasTab() },
      switchTab: {
        run: () => {
          const index = groupTabs.findIndex((tab) => tab.id === activeId);
          const next = groupTabs[(index + 1) % groupTabs.length];
          if (next) focusTab(next.id);
        },
        isEnabled: () => groupTabs.length >= 2,
      },
    },
    { active: isFocusedGroup },
  );

  return (
    <div
      ref={setDropRef}
      onMouseDown={() => {
        if (!isFocusedGroup) focusGroup(groupId);
      }}
      className={`mdbc-pane-group${isDropOver ? " drop-target" : ""}`}
    >
      <TabBar
        tabs={groupTabs}
        activeId={activeId}
        focused={isFocusedGroup}
        onFocus={focusTab}
        onClose={closeTab}
        onAdd={newTab}
        onAddTerminal={newTerminalTab}
        onAddNotebook={newNotebookTab}
        onAddCanvas={newCanvasTab}
        onSplit={handleSplit}
        onRename={handleRename}
      />
      {groupTabs.filter(t => t.tabType === "terminal").map(t => (
        <div key={t.id} className={`mdbc-tab-content${t.id === activeId ? "" : " hidden"}`}>
          <TerminalView tabId={t.id} />
        </div>
      ))}
      <EditorTabRouter
        activeTab={activeTab}
        tableProps={{
          tabConnectionId,
          connections,
          runActiveTab,
        }}
        consoleProps={{
          groupId,
          focusGroup,
          editorHostRef,
          editorHandleRef,
          editorMenu,
          editorCtxItems,
          onEditorContextMenu,
          onEditorContextMenuClose,
          runActiveTab,
          shortcut,
          tabConnection,
          tabConnectionId,
          connections,
          switchMongoQueryMode,
          switchEsQueryMode,
          switchRedisQueryMode,
          currentDbtNodeName: currentDbtNode?.name ?? null,
          currentDbtNodeId: currentDbtNode?.uniqueId ?? null,
          isDbtModel,
          runningCommand,
          dbtSelector,
          setDbtSelector,
          dbtPrimaryAction,
          setDbtPrimaryAction,
          showCompiled,
          setShowCompiled,
          setShowLineage,
          showLineage,
          showTransaction,
          onToggleTransaction: toggleTransaction,
          isCompiling,
          handleDbtRun,
          handleDbtTest,
          handleDbtBuild,
          handleDbtCompile,
          handleDbtPreview,
          showDiffConfig,
          onToggleDiffConfig: () => setShowDiffConfig((v) => !v),
          onRunDiff: handleDbtDiff,
          isDiffing,
          isPreviewing,
          compiledSql,
          compiledStale,
          compileError: currentDbtNode ? (compileErrors[currentDbtNode.name] ?? false) : false,
          showDocs,
          setShowDocs,
          isGeneratingDocs,
          handleDbtDocs,
          regenerateDocs,
          docs,
          docsStale,
          docsError,
          currentSqlMeshModelName: currentSqlMeshModel?.name ?? null,
          isSqlMeshModel,
          isSqlMeshPythonModel,
          isSqlMeshTestFile,
          currentSqlMeshTestName,
          handleSmTestAtCursor,
          handleSmTestFile,
          smRunningCommand,
          smSelector,
          setSmSelector,
          smPrimaryAction,
          setSmPrimaryAction,
          showRendered,
          setShowRendered,
          isRendering,
          renderError: currentSqlMeshModel ? (renderErrors[currentSqlMeshModel.name] ?? false) : false,
          handleSmPlan,
          handleSmRun,
          handleSmTest,
          handleSmRender,
          handleSmLint,
          handleSmAudit,
          handleSmPreview,
          renderedSql,
          renderedStale,
          onSelectConnection: handleSelectConnection,
          isFederation: activeTab?.isFederation ?? false,
          onToggleFederation: handleToggleFederation,
          onNewTab: newTab,
          isMarkdown,
          showRunBar,
          markdownView,
          onSetMarkdownView: setMarkdownView,
          markdownSource: markdownLiveText,
        }}
      />
    </div>
  );
}

export { EditorPane };
