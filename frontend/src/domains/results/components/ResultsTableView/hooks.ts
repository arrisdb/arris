import { useConnectionsStore } from "@domains/connection";
import { useRunHistoryStore } from "../../hooks";
import { type CellLocator, type QueryRunInput, type QueryRunResult, type RequestedPaneMode, type ResultsPaneMode } from "../../types";
import { usePinnedQueriesStore } from "@domains/pinnedQueries";
import { type RefObject, useEffect } from "react";
import { queryLanguageForEditorKind, useRegisterCommands } from "@shell/utils";
import { mountEditor } from "@domains/editor";
import type { EditorTab } from "@shell/types";
import type { QueryResult, QueryValue, SchemaNode } from "./types";
import {
  applyMutationsIPC,
  listSchemasIPC,
  primaryKeyIPC,
  runFederationQueryIPC,
  runQueryIPC,
} from "./ipc";
import { buildBatchForTab, extractIpcError, pickExportPath, writeExport, type EditingSnapshot, type ExportFormat } from "./utils";
import type { ChartSpec } from "@shared";
import { reconcileChartSpec } from "@domains/chart";

interface DismissOnOutsideInput {
  isOpen: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

interface ReadonlyQueryEditorInput {
  isOpen: boolean;
  hostRef: RefObject<HTMLDivElement | null>;
  queryTextSql: string;
  editorFontSize: number;
}

interface SyncFilterDraftInput {
  tabId: string | null;
  filterRaw: string;
  setFilterDraft: (value: string) => void;
}

interface SwitchDmlToOutputInput {
  tabId: string | null;
  activeRunId?: string;
  activeRunIsDml: boolean;
  setMode: (tabId: string, mode: ResultsPaneMode) => void;
}

interface ReconcileChartSpecInput {
  tabId: string | null;
  chart: ChartSpec | undefined;
  result: QueryResult | undefined;
  updateTab: (id: string, patch: Partial<EditorTab>) => void;
}

interface RequestedPaneModeInput {
  tabId: string | null;
  requestedPaneMode: RequestedPaneMode;
  bottomPaneVisible: boolean;
  setMode: (tabId: string, mode: ResultsPaneMode) => void;
  setRequestedPaneMode: (mode: RequestedPaneMode) => void;
  toggleBottomPane: () => void;
}

interface ResultsTableActionsInput {
  activeRun: QueryRunResult | undefined;
  addInsert: (insert: { tabId: string; draftId: string; values: Record<string, QueryValue> }) => void;
  currentPage: number;
  deletes: EditingSnapshot["deletes"];
  edits: EditingSnapshot["edits"];
  filterDraft: string;
  inserts: EditingSnapshot["inserts"];
  pageSize: number;
  patchRun: (tabId: string, runId: string, patch: Partial<QueryRunResult>) => void;
  pResetPage: (tabId: string) => void;
  resetEditing: (tabId: string) => void;
  result: QueryResult | undefined;
  setEdit: (locator: CellLocator, edit: { original: QueryValue | null; next: QueryValue }) => void;
  setFilter: (tabId: string, raw: string) => void;
  setFilterBusy: (busy: boolean) => void;
  setFilterError: (error: string | null) => void;
  setSchema: (connectionId: string, schema: SchemaNode[]) => void;
  setUploadBusy: (busy: boolean) => void;
  setUploadError: (error: string | null) => void;
  tab: EditorTab | undefined;
  tabId: string | null;
  updateTab: (id: string, patch: Partial<EditorTab>) => void;
}

function useRequestedPaneMode({
  tabId,
  requestedPaneMode,
  bottomPaneVisible,
  setMode,
  setRequestedPaneMode,
  toggleBottomPane,
}: RequestedPaneModeInput) {
  useEffect(() => {
    if (requestedPaneMode) {
      if (tabId) setMode(tabId, requestedPaneMode);
      setRequestedPaneMode(null);
      if (!bottomPaneVisible) toggleBottomPane();
    }
  }, [bottomPaneVisible, requestedPaneMode, setMode, setRequestedPaneMode, tabId, toggleBottomPane]);
}

function useDismissOnOutside({
  isOpen,
  anchorRef,
  onClose,
}: DismissOnOutsideInput) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onMouseDown = (event: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [isOpen, anchorRef, onClose]);
}

function useReadonlyQueryEditor({
  isOpen,
  hostRef,
  queryTextSql,
  editorFontSize,
}: ReadonlyQueryEditorInput) {
  useEffect(() => {
    if (!isOpen || !hostRef.current) return;
    return mountEditor({
      host: hostRef.current,
      initialDoc: queryTextSql,
      languageId: "sql",
      readOnly: true,
      fontSize: editorFontSize,
    }).destroy;
  }, [isOpen, hostRef, queryTextSql, editorFontSize]);
}

function useSyncFilterDraft({
  tabId,
  filterRaw,
  setFilterDraft,
}: SyncFilterDraftInput) {
  useEffect(() => {
    setFilterDraft(filterRaw);
  }, [tabId, filterRaw, setFilterDraft]);
}

function useSwitchDmlToOutput({
  tabId,
  activeRunId,
  activeRunIsDml,
  setMode,
}: SwitchDmlToOutputInput) {
  useEffect(() => {
    if (tabId && activeRunIsDml) {
      setMode(tabId, "output");
    }
  }, [activeRunId, activeRunIsDml, setMode, tabId]);
}

function useReconcileChartSpec({
  tabId,
  chart,
  result,
  updateTab,
}: ReconcileChartSpecInput) {
  useEffect(() => {
    if (!tabId || !chart || !result) return;
    const next = reconcileChartSpec(chart, result);
    const changed =
      next.xColumn !== chart.xColumn ||
      next.yColumns.length !== chart.yColumns.length ||
      next.yColumns.some((column, index) => column !== chart.yColumns[index]);
    if (changed) updateTab(tabId, { chart: next });
  }, [tabId, chart, result, updateTab]);
}

function useResultsTableActions({
  activeRun,
  addInsert,
  currentPage,
  deletes,
  edits,
  filterDraft,
  inserts,
  pageSize,
  patchRun,
  pResetPage,
  resetEditing,
  result,
  setEdit,
  setFilter,
  setFilterBusy,
  setFilterError,
  setSchema,
  setUploadBusy,
  setUploadError,
  tab,
  tabId,
  updateTab,
}: ResultsTableActionsInput) {
  function locator(rowIndex: number, column: string): CellLocator {
    return { tabId: tabId!, rowIndex, column };
  }

  function commitEdit(rowIndex: number, columnName: string, next: QueryValue) {
    if (!tabId || !result) return;
    const original =
      result.rows[rowIndex]?.[
        result.columns.findIndex((column) => column.name === columnName)
      ] ?? null;
    setEdit(locator(rowIndex, columnName), { original, next });
  }

  function onAddInsert() {
    if (!tabId) return;
    addInsert({
      tabId,
      draftId: crypto.randomUUID(),
      values: {},
    });
  }

  async function commitFilterDraft() {
    if (!tabId || (!tab?.connectionId && !tab?.isFederation)) return;
    pResetPage(tabId);
    const expr = filterDraft.trim();
    setFilter(tabId, expr);
    setFilterError(null);
    if (!expr) {
      await rerunOriginalQuery();
      return;
    }
    const baseSql = (activeRun?.sqlSnapshot ?? tab.text).replace(/;\s*$/, "");
    const wrappedSql = `SELECT * FROM (${baseSql}) AS _filtered WHERE ${expr}`;
    setFilterBusy(true);
    try {
      const res = tab.isFederation
        ? await runFederationQueryIPC(wrappedSql)
        : await runQueryIPC(tab.connectionId!, wrappedSql, [], queryLanguageForEditorKind(tab.kind), pageSize, 0);
      if (activeRun?.id && tabId) {
        patchRun(tabId, activeRun.id, { result: res });
      } else {
        updateTab(tabId, { result: res });
      }
    } catch (e) {
      setFilterError(extractIpcError(e).message);
    } finally {
      setFilterBusy(false);
    }
  }

  async function rerunOriginalQuery(overridePage?: number, overridePageSize?: number) {
    if (!tabId || (!tab?.connectionId && !tab?.isFederation)) return;
    const sql = activeRun?.sqlSnapshot ?? tab.text;
    const pg = overridePage ?? currentPage;
    const ps = overridePageSize ?? pageSize;
    setFilterBusy(true);
    setFilterError(null);
    try {
      const res = tab.isFederation
        ? await runFederationQueryIPC(sql)
        : await runQueryIPC(tab.connectionId!, sql, [], queryLanguageForEditorKind(tab.kind), ps, pg);
      if (activeRun?.id && tabId) {
        patchRun(tabId, activeRun.id, { result: res });
      } else {
        updateTab(tabId, { result: res });
      }
    } catch (e) {
      setFilterError(extractIpcError(e).message);
    } finally {
      setFilterBusy(false);
    }
  }

  async function exportAllRows(format: ExportFormat) {
    if (!result) return;
    // Pick the destination FIRST, before the (unpaginated) re-run, so the save
    // dialog opens immediately rather than after every row is fetched.
    const path = await pickExportPath(format);
    if (!path) return;
    const sql = activeRun?.sqlSnapshot ?? tab?.text;
    // Re-run the query with no pagination (page_size/page omitted => full result)
    // so the file holds every row, not just the visible page. Fall back to the
    // current page when the query can't be re-run (no connection/sql).
    if (!sql || (!tab?.connectionId && !tab?.isFederation)) {
      await writeExport(path, result.columns, result.rows, format);
      return;
    }
    const full = tab.isFederation
      ? await runFederationQueryIPC(sql)
      : await runQueryIPC(tab.connectionId!, sql, [], queryLanguageForEditorKind(tab.kind));
    await writeExport(path, full.columns, full.rows, format);
  }

  async function upload() {
    if (!tab || !tabId || !result) return;
    if (!tab.tableRef) {
      setUploadError("No table bound to this tab. Browse a table to edit.");
      return;
    }
    if (!tab.connectionId) {
      setUploadError("Tab has no connection.");
      return;
    }
    setUploadBusy(true);
    setUploadError(null);
    let pkColumns: string[];
    try {
      const pk = await primaryKeyIPC(tab.connectionId, tab.tableRef);
      if (!pk || pk.length === 0) {
        setUploadError(`"${tab.tableRef.name}" has no primary key.`);
        setUploadBusy(false);
        return;
      }
      pkColumns = pk;
    } catch (e) {
      setUploadError(extractIpcError(e).message);
      setUploadBusy(false);
      return;
    }
    const resolvePrimaryKey = (rowIndex: number): Record<string, QueryValue> => {
      const out: Record<string, QueryValue> = {};
      for (const col of pkColumns) {
        const ci = result.columns.findIndex((column) => column.name === col);
        if (ci >= 0) out[col] = result.rows[rowIndex]?.[ci] ?? { kind: "null" };
      }
      return out;
    };
    const batch = buildBatchForTab(tabId, { edits, inserts, deletes }, resolvePrimaryKey);
    if (batch.updates.length + batch.inserts.length + batch.deletes.length === 0) {
      setUploadBusy(false);
      return;
    }
    const originalSql = activeRun?.sqlSnapshot ?? tab.text;
    const originalRunId = activeRun?.id;
    const mutStarted = Date.now();
    const parts: string[] = [];
    if (batch.updates.length) parts.push(`${batch.updates.length} updated`);
    if (batch.inserts.length) parts.push(`${batch.inserts.length} inserted`);
    if (batch.deletes.length) parts.push(`${batch.deletes.length} deleted`);
    const tablePath = [tab.tableRef.schema, tab.tableRef.name].filter(Boolean).join(".");
    const mutSummary = `${parts.join(", ")} in ${tablePath}`;

    const logMutation = (entry: QueryRunInput) => {
      useRunHistoryStore.getState().appendRun(tabId, entry);
    };

    try {
      const mutResult = await applyMutationsIPC(tab.connectionId, tab.tableRef, batch);
      const mutEnded = Date.now();
      resetEditing(tabId);
      const sqlSnapshot = mutResult.statements.length > 0
        ? mutResult.statements.join(";\n")
        : mutSummary;
      logMutation({
        id: crypto.randomUUID(),
        startedAt: mutStarted,
        endedAt: mutEnded,
        status: "success",
        sqlSnapshot,
        connectionId: tab.connectionId,
        result: { columns: [], rows: [], rows_affected: mutResult.rows_affected, elapsed: (mutEnded - mutStarted) / 1000, statement_type: "mutation" },
      });
      try {
        const refreshed = await runQueryIPC(tab.connectionId, originalSql, [], queryLanguageForEditorKind(tab.kind));
        if (originalRunId && tabId) {
          patchRun(tabId, originalRunId, { result: refreshed });
        } else {
          updateTab(tabId, { result: refreshed });
        }
      } catch {
        // best effort: data already committed
      }
      try {
        const fresh = await listSchemasIPC(tab.connectionId);
        setSchema(tab.connectionId, fresh);
      } catch {
        // best effort: schema refresh is non-critical
      }
    } catch (e) {
      const mutEnded = Date.now();
      const ipcErr = extractIpcError(e);
      const friendly = ipcErr.code === "serialization"
        ? `Type mismatch: a value doesn't match the column type. ${ipcErr.message}`
        : `Upload failed: ${ipcErr.message}`;
      logMutation({
        id: crypto.randomUUID(),
        startedAt: mutStarted,
        endedAt: mutEnded,
        status: "error",
        sqlSnapshot: mutSummary,
        error: friendly,
      });
      setUploadError(friendly);
    } finally {
      setUploadBusy(false);
    }
  }

  function pinQuery() {
    if (!tab) return;
    const sqlText = activeRun?.sqlSnapshot ?? tab.text;
    if (!sqlText?.trim()) return;
    const conn = useConnectionsStore.getState().connections.find(
      (connection) => connection.id === tab.connectionId,
    );
    const pinnedQueriesStore = usePinnedQueriesStore.getState();
    pinnedQueriesStore.addQuery({
      name: "Untitled query",
      text: sqlText,
      connectionId: tab.connectionId,
      kind: conn?.kind ?? "sql",
    });
    pinnedQueriesStore.openPane();
  }

  return {
    commitEdit,
    commitFilterDraft,
    exportAllRows,
    onAddInsert,
    pinQuery,
    rerunOriginalQuery,
    upload,
  };
}

interface ResultsKeymapActionsInput {
  enabled: boolean;
  browseEditable: boolean;
  canRunQuery: boolean;
  chartMode: boolean;
  fedDagVisible: boolean;
  selectedRow: number | null;
  onShowTableView: () => void;
  onShowChartView: () => void;
  onRerunQuery: () => void;
  onToggleExecutionPlan: () => void;
  onToggleQueryText: () => void;
  onToggleFilter: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onInsertRow: () => void;
  onDeleteRow: () => void;
  onResetEdits: () => void;
  onUpload: () => void;
}

// Registers the results-toolbar and table-editing commands while the active
// results tab is mounted. The keyboard shortcut and the matching toolbar button
// invoke the same handler through the command registry; isEnabled mirrors when
// each action is applicable so disabled commands no-op from either entry point.
function useResultsKeymapActions(input: ResultsKeymapActionsInput) {
  const {
    enabled,
    browseEditable,
    canRunQuery,
    chartMode,
    fedDagVisible,
    selectedRow,
    onShowTableView,
    onShowChartView,
    onRerunQuery,
    onToggleExecutionPlan,
    onToggleQueryText,
    onToggleFilter,
    onPreviousPage,
    onNextPage,
    onInsertRow,
    onDeleteRow,
    onResetEdits,
    onUpload,
  } = input;
  const editable = browseEditable && !chartMode;
  useRegisterCommands(
    {
      showTableView: { run: onShowTableView },
      showChartView: { run: onShowChartView },
      rerunQuery: { run: onRerunQuery, isEnabled: () => canRunQuery },
      toggleExecutionPlan: { run: onToggleExecutionPlan, isEnabled: () => fedDagVisible },
      toggleQueryText: { run: onToggleQueryText },
      toggleFilterRow: { run: onToggleFilter, isEnabled: () => !chartMode },
      previousPage: { run: onPreviousPage, isEnabled: () => !chartMode },
      nextPage: { run: onNextPage, isEnabled: () => !chartMode },
      insertRow: { run: onInsertRow, isEnabled: () => editable },
      deleteRow: { run: onDeleteRow, isEnabled: () => editable && selectedRow !== null },
      resetEdits: { run: onResetEdits, isEnabled: () => editable },
      uploadChanges: { run: onUpload, isEnabled: () => editable },
    },
    { active: enabled },
  );
}

export {
  useDismissOnOutside,
  useReconcileChartSpec,
  useRequestedPaneMode,
  useResultsKeymapActions,
  useResultsTableActions,
  useReadonlyQueryEditor,
  useSwitchDmlToOutput,
  useSyncFilterDraft,
};
