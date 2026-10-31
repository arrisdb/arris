import type { RunRecord } from "@domains/history";
import { fetchServerRunPageIPC, listServerRunsIPC } from "../components/RunHistoryChips/ipc";
import { SERVER_RESULT_PAGE_SIZE, SERVER_RUNS_LIMIT, SERVER_RUNS_TAB_ID, SERVER_RUN_RUNNING } from "../constants";
import { useRunHistoryStore } from "./runHistoryStore";

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

// History holds no rows, so a server run fetches its cached page when first selected.
function loadSelectedRunResult(): void {
  const { runsByTab, selectedRunId, patchRun } = useRunHistoryStore.getState();
  const run = runsByTab[SERVER_RUNS_TAB_ID]?.find((r) => r.id === selectedRunId);
  if (!run || run.result || run.status !== "success") return;
  fetchServerRunPageIPC(run.id, SERVER_RESULT_PAGE_SIZE)
    .then((result) => patchRun(SERVER_RUNS_TAB_ID, run.id, { result }))
    .catch(() => {});
}

export { appendServerRun, hydrateServerRuns, loadSelectedRunResult };
