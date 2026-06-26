import { useConnectionsStore } from "@domains/connection";
import { useResultsTableStore, useRunHistoryStore } from "@domains/results";
// Imperative query actions reused by the global keymap (Cmd+T/W/Enter) and
// the per-pane Run/Dry-run/Explain toolbar buttons. Pulls all state from the
// stores so it works regardless of where it is invoked from.

import { findLeaf, firstLeaf } from "@shell/utils/paneTree";
import { useNotebookStore } from "@domains/notebook/hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { useTransactionStore } from "../../hooks/transactionStore";
import type { EditorTab } from "@shell/types";
import { serializeNotebook } from "@domains/notebook";
import { kindForConnection, queryLanguageForEditorKind } from "@shell/utils";
import { useGitStore } from "@domains/git/hooks";
import { useFilesStore } from "@domains/files/hooks";
import { useDbtStore } from "@domains/dbt/hooks";
import { exportResults, type ExportFormat } from "@domains/results";
import { useSettingsStore } from "@shared/settings";
import { ipcErrorMessage, type PlanResult } from "@shared";
import {
  cancelQueryIPC,
  explainQueryIPC,
  gitFileDiffHunksIPC,
  runQueryIPC,
  writeTextFileIPC,
} from "./ipc";
import { findLineAt, findStatementAt } from "@domains/editor/utils/navigation/statementSplit";
import { findEsRestRequestAt } from "@domains/editor/utils/dialects/connections/esRestLanguage";

type RunMode = "run" | "dryRun" | "analyze";

// Editor kinds whose buffers hold multiple `;`-delimited statements, so a run
// executes only the statement under the cursor. `mongoshell` (mongosh) splits
// the same way as SQL; `esrest` uses its own blank-line request boundaries.
const STATEMENT_SPLIT_KINDS = new Set([
  "sql",
  "kafka",
  "elasticsearch",
  "redis",
  "mongodb",
  "mongoshell",
]);

// Resolve the exact text to execute for a tab. Preference order:
//   1. an explicit, non-empty editor selection: run the highlight verbatim
//   2. the statement under the cursor (esrest request / `;`-delimited statement)
//   3. the whole buffer
function resolveRunSql(tab: EditorTab): string {
  const text = tab.text ?? "";
  const sel = tab.selection;
  if (sel && sel.to > sel.from) {
    const selected = text.slice(sel.from, sel.to).trim();
    if (selected) return selected;
  }
  if (tab.kind === "esrest" && tab.cursor != null) {
    const req = findEsRestRequestAt(text, tab.cursor);
    return (req ? text.slice(req.from, req.to) : text).trim();
  }
  // Redis CLI is line-delimited (one command per line, no `;`), so a run
  // executes only the command line under the cursor.
  if (tab.kind === "rediscli" && tab.cursor != null) {
    const line = findLineAt(text, tab.cursor);
    return (line ? text.slice(line.from, line.to) : text).trim();
  }
  if (STATEMENT_SPLIT_KINDS.has(tab.kind) && tab.cursor != null) {
    const stmt = findStatementAt(text, tab.cursor);
    return (stmt ? text.slice(stmt.from, stmt.to) : text).trim();
  }
  return text.trim();
}

// Character range of the statement a run will execute, mirroring the preference
// order of `resolveRunSql`. Anchors the editor's run-status indicator to the
// executed statement's first line. Falls back to the whole buffer.
function resolveRunRange(tab: EditorTab): { from: number; to: number } {
  const text = tab.text ?? "";
  const whole = { from: 0, to: text.length };
  const sel = tab.selection;
  if (sel && sel.to > sel.from && text.slice(sel.from, sel.to).trim()) {
    return { from: sel.from, to: sel.to };
  }
  if (tab.kind === "esrest" && tab.cursor != null) {
    const req = findEsRestRequestAt(text, tab.cursor);
    return req ? { from: req.from, to: req.to } : whole;
  }
  if (tab.kind === "rediscli" && tab.cursor != null) {
    const line = findLineAt(text, tab.cursor);
    return line ? { from: line.from, to: line.to } : whole;
  }
  if (STATEMENT_SPLIT_KINDS.has(tab.kind) && tab.cursor != null) {
    const stmt = findStatementAt(text, tab.cursor);
    return stmt ? { from: stmt.from, to: stmt.to } : whole;
  }
  return whole;
}

// Shown when a run/preview is attempted without a usable connection: either
// none is selected or the tab points at a connection that no longer exists.
const NO_CONNECTION_MESSAGE =
  "No connection selected. Pick a connection from the selector in the top-right before running.";

// The backend reports a missing connection as `connection <uuid> not found`,
// which leaks an internal id and tells the user nothing actionable. Rewrite it
// to the friendly guidance; pass every other error through untouched.
function runErrorMessage(e: unknown): string {
  const msg = ipcErrorMessage(e);
  return /^connection\s+.+\s+not found$/i.test(msg) ? NO_CONNECTION_MESSAGE : msg;
}

// dbt Cloud-style model preview: default row cap applied to the wrapped
// compiled SQL so the warehouse never streams a whole table back.
const DBT_PREVIEW_ROW_LIMIT = 500;

// Wrap a model's compiled SQL as a limited subquery so it can run directly on
// the mapped connection without the model being materialized first.
function buildPreviewSql(
  compiledSql: string,
  limit: number = DBT_PREVIEW_ROW_LIMIT,
): string {
  const inner = compiledSql.trim().replace(/;\s*$/, "").trimEnd();
  return `SELECT * FROM (\n${inner}\n) AS dbt_preview LIMIT ${limit}`;
}

// Resolve which connection a tab's queries run against. dbt model files opened
// from the dbt pane carry no tab connection, so for dbt nodes the dbt pane's
// mapped connection (the project-level Connection pick) is the default before
// falling back to the globally selected connection.
function resolveTabConnectionId(opts: {
  tabConnectionId: string | null | undefined;
  isDbtNode: boolean;
  dbtPickedConnectionId: string | null;
  selectedConnectionId: string | null;
}): string | null {
  const { tabConnectionId, isDbtNode, dbtPickedConnectionId, selectedConnectionId } = opts;
  return (
    tabConnectionId ??
    (isDbtNode ? dbtPickedConnectionId : null) ??
    selectedConnectionId ??
    null
  );
}

function revertToLastSuccess(tabId: string, errorRunId: string) {
  const { runsByTab, selectRun } = useRunHistoryStore.getState();
  const runs = runsByTab[tabId] ?? [];
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].id !== errorRunId && runs[i].status === "success") {
      selectRun(runs[i].id);
      return;
    }
  }
}

function activeTab(): EditorTab | null {
  const tabs = useTabsStore.getState();
  const focused = tabs.focusedPaneGroupId
    ? findLeaf(tabs.layout, tabs.focusedPaneGroupId)
    : null;
  const group = focused ?? firstLeaf(tabs.layout);
  if (!group?.selectedTabId) return null;
  return tabs.tabs.find((t) => t.id === group.selectedTabId) ?? null;
}

function executeActiveQuery(mode: RunMode): boolean {
  const tab = activeTab();
  if (!tab) return false;
  const dbt = useDbtStore.getState();
  const isDbtNode = !!tab.filePath && !!dbt.project?.nodes.some((n) => n.filePath === tab.filePath);
  const tabConnectionId = resolveTabConnectionId({
    tabConnectionId: tab.connectionId,
    isDbtNode,
    dbtPickedConnectionId: dbt.pickedConnectionId,
    selectedConnectionId: useConnectionsStore.getState().selectedId ?? null,
  });
  if (!tabConnectionId) return false;
  const sql = resolveRunSql(tab);
  if (!sql) return false;
  if (tab.isRunning) return false;
  const { updateTab } = useTabsStore.getState();
  const { appendRun, patchRun } = useRunHistoryStore.getState();
  const runId = crypto.randomUUID();
  const queryId = crypto.randomUUID();
  const startedAt = Date.now();
  appendRun(tab.id, { id: runId, sqlSnapshot: sql, status: "pending", startedAt, connectionId: tabConnectionId });
  useSettingsStore.getState().showBottomPane();
  updateTab(tab.id, {
    isRunning: true,
    queryId,
    runRange: resolveRunRange(tab),
    error: undefined,
    pane: mode === "run" ? "results" : "plan",
  });
  if (mode === "run") {
    const ps = useResultsTableStore.getState();
    ps.resetPage(tab.id);
    const pSize = ps.getPageSize(tab.id);
    const language = queryLanguageForEditorKind(tab.kind);
    // In manual mode this statement opens (or joins) a transaction, so the
    // connection now has pending work the user must commit or roll back, and
    // the statement is recorded for the transaction reference pane.
    const isManualTx = useTransactionStore.getState().configFor(tabConnectionId).mode === "manual";
    if (isManualTx) {
      useTransactionStore.getState().markDirty(tabConnectionId);
    }
    runQueryIPC(tabConnectionId, tab.text, [], language, pSize, 0, queryId)
      .then((result) => {
        const isDml = result.rows_affected != null;
        updateTab(tab.id, {
          result: isDml ? undefined : result,
          isRunning: false,
          plan: undefined,
          error: undefined,
          pane: "results",
        });
        patchRun(tab.id, runId, { status: "success", result, endedAt: Date.now() });
        if (isManualTx) {
          useTransactionStore.getState().recordStatement(tabConnectionId, {
            sql: tab.text,
            status: "success",
            rowsAffected: result.rows_affected ?? null,
          });
        }
        if (isDml) {
          useRunHistoryStore.getState().setRequestedPaneMode("output");
        }
      })
      .catch((e) => {
        const msg = runErrorMessage(e);
        updateTab(tab.id, { error: msg, isRunning: false });
        patchRun(tab.id, runId, { status: "error", error: msg, endedAt: Date.now() });
        if (isManualTx) {
          useTransactionStore.getState().recordStatement(tabConnectionId, {
            sql: tab.text,
            status: "error",
            rowsAffected: null,
            error: msg,
          });
        }
        revertToLastSuccess(tab.id, runId);
        useRunHistoryStore.getState().setRequestedPaneMode("output");
      });
    return true;
  }
  const language = queryLanguageForEditorKind(tab.kind);
  explainQueryIPC(tabConnectionId, tab.text, mode === "analyze" ? "analyze" : "dryRun", [], language)
    .then((plan: PlanResult) => {
      updateTab(tab.id, { plan, isRunning: false, error: undefined, pane: "plan" });
      patchRun(tab.id, runId, { status: "success", endedAt: Date.now() });
    })
    .catch((e) => {
      const msg = runErrorMessage(e);
      updateTab(tab.id, { error: msg, isRunning: false });
      patchRun(tab.id, runId, { status: "error", error: msg, endedAt: Date.now() });
      revertToLastSuccess(tab.id, runId);
      useRunHistoryStore.getState().setRequestedPaneMode("output");
    });
  return true;
}

function openNewConsoleTab(): boolean {
  const conns = useConnectionsStore.getState();
  const conn = conns.connections.find((c) => c.id === conns.selectedId);
  useTabsStore.getState().addTab({
    connectionId: conn?.id,
    kind: conn ? kindForConnection(conn.kind) : "sql",
  });
  return true;
}

function closeActiveTab(): boolean {
  const tab = activeTab();
  if (!tab) return false;
  useTabsStore.getState().closeTab(tab.id);
  return true;
}

function stopActiveQuery(): boolean {
  const tab = activeTab();
  if (!tab?.isRunning) return false;
  if (tab.queryId) {
    cancelQueryIPC(tab.queryId).catch(() => {});
  }
  useTabsStore.getState().updateTab(tab.id, {
    isRunning: false,
    error: "Query cancelled",
    queryId: undefined,
  });
  return true;
}

function saveActiveFile(): boolean {
  const tab = activeTab();
  // Media tabs are read-only binary previews; their `text` is empty, so writing
  // it back would truncate the image/asset on disk.
  if (!tab?.filePath || tab.tabType === "media") return false;
  const filePath = tab.filePath;
  // Notebooks keep their live document in the notebook store, not tab.text, so
  // serialize that back to nbformat; everything else writes the editor text.
  const notebook =
    tab.tabType === "notebook" ? useNotebookStore.getState().notebooks[tab.id] : null;
  if (tab.tabType === "notebook" && !notebook) return false;
  const content = notebook ? serializeNotebook(notebook) : tab.text;
  writeTextFileIPC(filePath, content)
    .then(async () => {
      if (notebook) useNotebookStore.getState().markSaved(tab.id);
      const gitRepo = useGitStore.getState().repoPath;
      const repo = gitRepo ?? useFilesStore.getState().rootPath;
      if (repo) {
        if (gitRepo) {
          await useGitStore.getState().refreshFileStatuses().catch(() => {});
        } else {
          await useGitStore.getState().refreshFromRepo(repo).catch(() => {});
        }
        gitFileDiffHunksIPC(repo, filePath).catch(() => []);
      }
    })
    .catch((e) => console.error("Save failed", e));
  return true;
}

function exportActiveResults(format: ExportFormat): boolean {
  const tab = activeTab();
  if (!tab?.result) return false;
  exportResults(tab.result.columns, tab.result.rows, format).catch((e) =>
    console.error("Export failed", e),
  );
  return true;
}

export type { RunMode };
export {
  NO_CONNECTION_MESSAGE,
  DBT_PREVIEW_ROW_LIMIT,
  resolveRunSql,
  resolveRunRange,
  runErrorMessage,
  buildPreviewSql,
  resolveTabConnectionId,
  executeActiveQuery,
  openNewConsoleTab,
  closeActiveTab,
  stopActiveQuery,
  saveActiveFile,
  exportActiveResults,
};
