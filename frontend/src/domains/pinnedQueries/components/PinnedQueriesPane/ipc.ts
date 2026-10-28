import { invoke } from "@tauri-apps/api/core";
import { apiCall, isWebShell } from "@shared/api";
import type { PinnedQuery } from "./types";

function loadPinnedQueriesIPC(): Promise<PinnedQuery[]> {
  if (isWebShell()) return apiCall("pin_list");
  return invoke("cmd_load_pinned_queries");
}

function savePinnedQueriesIPC(queries: PinnedQuery[]): Promise<void> {
  if (isWebShell()) return apiCall("pin_save", { queries });
  return invoke("cmd_save_pinned_queries", { queries });
}

export {
  loadPinnedQueriesIPC,
  savePinnedQueriesIPC,
};
