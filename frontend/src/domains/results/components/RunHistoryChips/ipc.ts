import { invoke } from "@tauri-apps/api/core";

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

function loadRunHistoryIPC(): Promise<PersistedRunHistoryEntry[]> {
  return invoke("cmd_load_run_history");
}

function saveRunHistoryIPC(runs: PersistedRunHistoryEntry[]): Promise<void> {
  return invoke("cmd_save_run_history", { runs });
}

export { loadRunHistoryIPC, saveRunHistoryIPC };
export type { PersistedRunHistoryEntry };
