import { apiCall } from "@shared/api";
import type { PinnedQuery, RunRecord } from "./types";

function listHistoryIPC(limit: number): Promise<RunRecord[]> {
  return apiCall("history_list", { limit });
}

function pinRunIPC(runId: string): Promise<PinnedQuery> {
  return apiCall("pin_add", { runId });
}

export { listHistoryIPC, pinRunIPC };
