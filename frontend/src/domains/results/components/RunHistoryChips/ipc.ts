import { invoke } from "@tauri-apps/api/core";
import { apiCall, isWebShell } from "@shared/api";
import type { QueryResult } from "@shared";
import type { RunRecord } from "@domains/history";

// On-disk shape for one run-history chip. Mirrors the Rust
// `PersistedRunHistoryEntry`: metadata + SQL only, never the result set. Owned
// here at the IPC boundary; the run-history store maps its `QueryRunResult`
// to/from this.
interface PersistedRunHistoryEntry {
  id: string;
  seq: number;
  ordinal: number;
  tabId: string;
  tabTitle: string;
  tabType?: string;
  startedAt: number;
  endedAt?: number;
  status: string;
  sqlSnapshot: string;
  connectionId?: string;
  customName?: string;
  pinned: boolean;
  error?: string;
  diffModel?: string;
  diffIndex?: number;
  logKind?: string;
}

// The browser's run log comes from server history, which also holds CLI runs.
function loadRunHistoryIPC(): Promise<PersistedRunHistoryEntry[]> {
  if (isWebShell()) return Promise.resolve([]);
  return invoke("cmd_load_run_history");
}

function saveRunHistoryIPC(runs: PersistedRunHistoryEntry[]): Promise<void> {
  if (isWebShell()) return Promise.resolve();
  return invoke("cmd_save_run_history", { runs });
}

function listServerRunsIPC(limit: number): Promise<RunRecord[]> {
  return apiCall("history_list", { limit });
}

function fetchServerRunPageIPC(runId: string, limit: number): Promise<QueryResult> {
  return apiCall("run_page", { runId, offset: 0, limit });
}

export { fetchServerRunPageIPC, listServerRunsIPC, loadRunHistoryIPC, saveRunHistoryIPC };
export type { PersistedRunHistoryEntry };
