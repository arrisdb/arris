import { invoke } from "@tauri-apps/api/core";
import type { PinnedQuery } from "./types";

function loadPinnedQueriesIPC(): Promise<PinnedQuery[]> {
  return invoke("cmd_load_pinned_queries");
}

function savePinnedQueriesIPC(queries: PinnedQuery[]): Promise<void> {
  return invoke("cmd_save_pinned_queries", { queries });
}

export {
  loadPinnedQueriesIPC,
  savePinnedQueriesIPC,
};
