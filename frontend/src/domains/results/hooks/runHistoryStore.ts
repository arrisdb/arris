// Chip metadata + SQL persist across restarts (run_history.json); result sets do
// NOT. On reload the chips reappear empty and the user re-runs to repopulate.

import { create } from "zustand";
import { useCommandLogStore } from "@domains/output/hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import {
  loadRunHistoryIPC,
  saveRunHistoryIPC,
  type PersistedRunHistoryEntry,
} from "../components/RunHistoryChips/ipc";
import type { QueryRunInput, QueryRunResult, RequestedPaneMode } from "../types";

function sqlRunSummary(run: QueryRunResult): string {
  if (run.status === "error") return run.error ?? "unknown error";
  const elapsed = (run.endedAt ?? run.startedAt) - run.startedAt;
  if (run.diffResult) {
    const d = run.diffResult;
    const summary = `+${d.addedCount} added / −${d.removedCount} removed vs prod (${elapsed} ms)`;
    return `${d.sql}\n\n${summary}`;
  }
  const affected = run.result?.rows_affected;
  if (affected != null) return `${affected} row(s) affected (${elapsed} ms)`;
  const rowCount = run.result?.rows?.length ?? 0;
  const isMutation = run.result?.statement_type === "mutation";
  return isMutation
    ? `completed in ${elapsed} ms`
    : `${rowCount} rows retrieved in ${elapsed} ms`;
}

// Newest run id across every tab (chronological), or undefined when empty.
function latestRunId(runsByTab: Record<string, QueryRunResult[]>): string | undefined {
  let latest: QueryRunResult | undefined;
  for (const list of Object.values(runsByTab)) {
    for (const run of list) {
      if (!latest || run.startedAt >= latest.startedAt) latest = run;
    }
  }
  return latest?.id;
}

// Drop the heavy result/diff payload; only chip metadata + SQL are persisted.
function toPersistedEntry(run: QueryRunResult): PersistedRunHistoryEntry {
  return {
    id: run.id,
    seq: run.seq,
    ordinal: run.ordinal,
    tabId: run.tabId,
    tabTitle: run.tabTitle,
    tabType: run.tabType,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    status: run.status,
    sqlSnapshot: run.sqlSnapshot,
    connectionId: run.connectionId,
    customName: run.customName,
    pinned: run.pinned ?? false,
    error: run.error,
    diffModel: run.diffModel,
    diffIndex: run.diffIndex,
    logKind: run.logKind,
  };
}

// Reconstruct a runtime run from a persisted entry; result stays undefined so
// the grid shows the "run a query" placeholder until the user re-runs.
function fromPersistedEntry(e: PersistedRunHistoryEntry): QueryRunResult {
  return {
    id: e.id,
    seq: e.seq,
    ordinal: e.ordinal,
    customName: e.customName,
    pinned: e.pinned,
    tabId: e.tabId,
    tabTitle: e.tabTitle,
    tabType: e.tabType as QueryRunResult["tabType"],
    startedAt: e.startedAt,
    endedAt: e.endedAt,
    status: e.status as QueryRunResult["status"],
    sqlSnapshot: e.sqlSnapshot,
    connectionId: e.connectionId,
    error: e.error,
    diffModel: e.diffModel,
    diffIndex: e.diffIndex,
    logKind: e.logKind as QueryRunResult["logKind"],
  };
}

// Flush chip metadata to disk. Table-tab runs are excluded; they never surface
// as cross-tab chips, so persisting them would only leave orphan buckets.
function persistRuns(runsByTab: Record<string, QueryRunResult[]>): void {
  const entries = Object.values(runsByTab)
    .flat()
    .filter((run) => run.tabType !== "table")
    .map(toPersistedEntry);
  void saveRunHistoryIPC(entries).catch(() => {});
}

interface RunHistoryState {
  /// Map keyed by tabId → run history (newest last). Table-browse tabs read
  /// their own bucket; the global Results Viewer flattens across all buckets.
  runsByTab: Record<string, QueryRunResult[]>;
  /// Globally selected run id; drives the cross-tab Results Viewer.
  selectedRunId: string | undefined;
  /// Monotonic sequence counter per tab (never resets on removeRun).
  nextSeqByTab: Record<string, number>;
  /// Global monotonic run number, assigned to each run's `ordinal`, never
  /// reused so the `#N` chip label is strictly increasing.
  nextOrdinal: number;
  /// Command-log entry id per in-flight run id (feeds the Command Logs pane).
  logIdByRun: Record<string, string>;
  requestedPaneMode: RequestedPaneMode;
  appendRun: (tabId: string, run: QueryRunInput) => void;
  patchRun: (
    tabId: string,
    runId: string,
    patch: Partial<QueryRunResult>,
  ) => void;
  selectRun: (runId: string) => void;
  removeRun: (tabId: string, runId: string) => void;
  clearTab: (tabId: string) => void;
  /// Override a run's chip label (empty string clears back to the default).
  renameRun: (runId: string, name: string) => void;
  /// Toggle a run's pinned state (pinned chips sort leftmost).
  togglePin: (runId: string) => void;
  setRequestedPaneMode: (mode: RequestedPaneMode) => void;
  hydrate: () => Promise<void>;
}

const useRunHistoryStore = create<RunHistoryState>((set, get) => ({
  runsByTab: {},
  selectedRunId: undefined,
  nextSeqByTab: {},
  nextOrdinal: 1,
  logIdByRun: {},
  requestedPaneMode: null,
  setRequestedPaneMode: (mode) => set({ requestedPaneMode: mode }),
  appendRun: (tabId, run) => {
    const sourceTab = useTabsStore.getState().tabs.find((t) => t.id === tabId);
    const tabTitle = sourceTab?.title ?? "";
    // A staged-edit commit on a table tab logs a mutation run purely for that
    // tab's command log. It must not steal the global selection; other
    // (console) tabs follow selectedRunId, and a selected mutation run forces
    // their viewer into the output/command-log view. Keep the prior selection.
    const isTableMutation =
      sourceTab?.tabType === "table" && run.result?.statement_type === "mutation";
    const logId = useCommandLogStore.getState().startCommand({
      kind: run.logKind ?? "sql",
      command: run.sqlSnapshot,
      startedAt: run.startedAt,
      tabId,
      tabTitle,
    });
    // Browse-mode staged-edit commits append the run already terminal (success
    // or error) in one shot; there is no follow-up patchRun to flip the
    // command-log spinner. Finalize the entry now so it doesn't hang on
    // "running"; only in-flight ("pending") runs wait for a later patchRun.
    const isTerminal = run.status === "success" || run.status === "error";
    if (isTerminal) {
      const cmdLog = useCommandLogStore.getState();
      cmdLog.appendOutput(logId, sqlRunSummary({ ...run, tabId, tabTitle, seq: 0, ordinal: 0 }));
      cmdLog.finishCommand(logId, {
        status: run.status === "success" ? "success" : "error",
        endedAt: run.endedAt ?? Date.now(),
      });
    }
    set((s) => {
      const list = s.runsByTab[tabId] ?? [];
      const seq = s.nextSeqByTab[tabId] ?? 1;
      const ordinal = s.nextOrdinal;
      return {
        runsByTab: { ...s.runsByTab, [tabId]: [...list, { ...run, tabId, tabTitle, tabType: sourceTab?.tabType, seq, ordinal }] },
        selectedRunId: isTableMutation ? s.selectedRunId : run.id,
        nextSeqByTab: { ...s.nextSeqByTab, [tabId]: seq + 1 },
        nextOrdinal: ordinal + 1,
        // Terminal runs are already finalized; no patchRun will reference them,
        // so don't track a logId that would never be cleaned up.
        logIdByRun: isTerminal
          ? s.logIdByRun
          : { ...s.logIdByRun, [run.id]: logId },
      };
    });
    persistRuns(get().runsByTab);
  },
  patchRun: (tabId, runId, patch) => {
    let merged: QueryRunResult | undefined;
    set((s) => {
      const list = s.runsByTab[tabId] ?? [];
      return {
        runsByTab: {
          ...s.runsByTab,
          [tabId]: list.map((r) => {
            if (r.id !== runId) return r;
            merged = { ...r, ...patch };
            return merged;
          }),
        },
      };
    });
    const logId = get().logIdByRun[runId];
    // Relabel the live command-log entry when the SQL becomes known. dbt preview
    // logs the entry immediately on click (placeholder label) so its spinner
    // shows during the compile, then swaps in the compiled SQL once resolved.
    if (logId && patch.sqlSnapshot) {
      useCommandLogStore.getState().updateCommand(logId, patch.sqlSnapshot);
    }
    if (!merged || !patch.status || patch.status === "pending") return;
    if (!logId) return;
    const cmdLog = useCommandLogStore.getState();
    cmdLog.appendOutput(logId, sqlRunSummary(merged));
    cmdLog.finishCommand(logId, {
      status: patch.status === "success" ? "success" : "error",
      endedAt: merged.endedAt ?? Date.now(),
    });
    set((s) => {
      const { [runId]: _drop, ...rest } = s.logIdByRun;
      return { logIdByRun: rest };
    });
    // The run reached a terminal status; its persisted metadata (status,
    // endedAt) changed, so flush. Pure result patches (pagination) skip this.
    persistRuns(get().runsByTab);
  },
  selectRun: (runId) => set({ selectedRunId: runId }),
  removeRun: (tabId, runId) => {
    set((s) => {
      const list = (s.runsByTab[tabId] ?? []).filter((r) => r.id !== runId);
      const runsByTab = { ...s.runsByTab, [tabId]: list };
      const selectedRunId =
        s.selectedRunId === runId ? latestRunId(runsByTab) : s.selectedRunId;
      return { runsByTab, selectedRunId };
    });
    persistRuns(get().runsByTab);
  },
  clearTab: (tabId) => {
    set((s) => {
      const { [tabId]: dropped = [], ...rest } = s.runsByTab;
      const { [tabId]: __, ...restSeq } = s.nextSeqByTab;
      const selectedRunId = dropped.some((r) => r.id === s.selectedRunId)
        ? latestRunId(rest)
        : s.selectedRunId;
      return { runsByTab: rest, nextSeqByTab: restSeq, selectedRunId };
    });
    persistRuns(get().runsByTab);
  },
  renameRun: (runId, name) => {
    const trimmed = name.trim();
    set((s) => ({
      runsByTab: Object.fromEntries(
        Object.entries(s.runsByTab).map(([tabId, list]) => [
          tabId,
          list.map((r) =>
            r.id === runId ? { ...r, customName: trimmed || undefined } : r,
          ),
        ]),
      ),
    }));
    persistRuns(get().runsByTab);
  },
  togglePin: (runId) => {
    set((s) => ({
      runsByTab: Object.fromEntries(
        Object.entries(s.runsByTab).map(([tabId, list]) => [
          tabId,
          list.map((r) => (r.id === runId ? { ...r, pinned: !r.pinned } : r)),
        ]),
      ),
    }));
    persistRuns(get().runsByTab);
  },
  hydrate: async () => {
    const entries = await loadRunHistoryIPC();
    const runsByTab: Record<string, QueryRunResult[]> = {};
    const maxSeqByTab: Record<string, number> = {};
    let nextOrdinal = 1;
    for (const entry of entries) {
      const run = fromPersistedEntry(entry);
      (runsByTab[run.tabId] ??= []).push(run);
      maxSeqByTab[run.tabId] = Math.max(maxSeqByTab[run.tabId] ?? 0, run.seq);
      nextOrdinal = Math.max(nextOrdinal, run.ordinal + 1);
    }
    // Counters resume one past the highest persisted value so numbers are never
    // reused across a restart.
    const nextSeqByTab = Object.fromEntries(
      Object.entries(maxSeqByTab).map(([tabId, seq]) => [tabId, seq + 1]),
    );
    set({
      runsByTab,
      nextSeqByTab,
      nextOrdinal,
      selectedRunId: latestRunId(runsByTab),
    });
  },
}));

export {
  useRunHistoryStore,
};
