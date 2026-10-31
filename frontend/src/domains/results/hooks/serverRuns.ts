import type { QueryResult } from "@shared";
import type { RunRecord } from "@domains/history";
import { fetchServerRunPageIPC, listServerRunsIPC } from "../components/RunHistoryChips/ipc";
import { SERVER_RESULT_PAGE_SIZE, SERVER_RUNS_LIMIT, SERVER_RUNS_TAB_ID, SERVER_RUN_RUNNING } from "../constants";
import { useRunHistoryStore } from "./runHistoryStore";

// The server's result cache is lost on restart; the preview in history is not.
function previewResult({ preview }: RunRecord): QueryResult | undefined {
  if (!preview) return undefined;
  return { columns: preview.columns, rows: preview.rows, elapsed: 0, has_more: preview.truncated };
}

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
async function hydrateServerRuns(): Promise<void> {
  const records = await listServerRunsIPC(SERVER_RUNS_LIMIT);
  [...records].reverse().forEach(appendRecord);
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

export { appendServerRun, hydrateServerRuns, loadSelectedRunResult };
