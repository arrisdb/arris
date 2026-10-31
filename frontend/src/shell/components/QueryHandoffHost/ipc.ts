import { apiCall } from "@shared/api";
import type { QueryResult } from "@shared";
import type { QueryHandoff } from "./types";

function takeQueryHandoffsIPC(): Promise<QueryHandoff[]> {
  return apiCall("query_handoff_take");
}

function fetchRunPageIPC(runId: string, offset: number, limit: number): Promise<QueryResult> {
  return apiCall("run_page", { runId, offset, limit });
}

export { fetchRunPageIPC, takeQueryHandoffsIPC };
