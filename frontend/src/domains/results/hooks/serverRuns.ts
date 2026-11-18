import type { QueryResult } from "@shared";
import type { RunRecord } from "../types";
import { fetchServerRunPageIPC, getServerRunIPC, listServerRunsIPC } from "../components/RunHistoryChips/ipc";
import { SERVER_RESULT_PAGE_SIZE, SERVER_RUNS_LIMIT, SERVER_RUNS_TAB_ID, SERVER_RUN_RUNNING } from "../constants";
import { useRunHistoryStore } from "./runHistoryStore";

// The server's result cache is lost on restart; the preview in history is not.
function previewResult({ preview }: RunRecord): QueryResult | undefined {
  if (!preview) return undefined;
  return { columns: preview.columns, rows: preview.rows, elapsed: 0, has_more: preview.truncated };
}

let hydration: Promise<void> = Promise.resolve();

function appendRecord(record: RunRecord): void {
  if (record.status === SERVER_RUN_RUNNING) return;
  useRunHistoryStore.getState().appendRun(SERVER_RUNS_TAB_ID, {
    id: record.id,
    sqlSnapshot: record.sql,
    status: record.status === "success" ? "success" : "error",
    startedAt: Date.parse(record.startedAt),
    endedAt: record.finishedAt ? Date.parse(record.finishedAt) : undefined,
    connectionId: record.connectionId,
    error: record.error ?? undefined,
    result: previewResult(record),
  });
}

// Newest-first from the server; the run log reads oldest-first.
function hydrateServerRuns(): Promise<void> {
  hydration = listServerRunsIPC(SERVER_RUNS_LIMIT).then((records) => {
    [...records].reverse().forEach(appendRecord);
  });
  return hydration;
}

// Selects a run for a deep link, fetching it if it is older than the restored log.
async function openServerRun(runId: string): Promise<string | undefined> {
  await hydration;
  const store = useRunHistoryStore.getState();
  const known = store.runsByTab[SERVER_RUNS_TAB_ID]?.find((run) => run.id === runId);
  if (known) {
    store.selectRun(runId);
    return known.connectionId;
  }
  const { run } = await getServerRunIPC(runId);
  appendRecord(run);
  return run.connectionId;
}

// Runs from this tab are already in its log; this adds the ones from the CLI.
function appendServerRun(record: RunRecord): void {
  if (record.source !== "ui") appendRecord(record);
}

// A cut-off preview swaps to the cached rows when selected, if the server still has them.
function loadSelectedRunResult(): void {
  const { runsByTab, selectedRunId, patchRun } = useRunHistoryStore.getState();
  const run = runsByTab[SERVER_RUNS_TAB_ID]?.find((r) => r.id === selectedRunId);
  if (!run || run.status !== "success") return;
  if (run.result && !run.result.has_more) return;
  fetchServerRunPageIPC(run.id, SERVER_RESULT_PAGE_SIZE)
    .then((result) => patchRun(SERVER_RUNS_TAB_ID, run.id, { result }))
    .catch(() => {});
}

export { appendServerRun, hydrateServerRuns, loadSelectedRunResult, openServerRun };
