import { apiCall } from "@shared/api";
import type { QueryResult } from "@shared";
import type { RunRecord } from "@domains/history";
import { RERUN_SOURCE } from "./constants";
import type { RunWithCache } from "./types";

function getRunIPC(runId: string): Promise<RunWithCache> {
  return apiCall("run_get", { runId });
}

function fetchRunPageIPC(
  runId: string,
  offset: number,
  limit: number,
): Promise<QueryResult> {
  return apiCall("run_page", { runId, offset, limit });
}

function rerunIPC(run: RunRecord): Promise<{ run: RunRecord }> {
  return apiCall("query_run", {
    connection: run.connectionId,
    sql: run.sql,
    source: RERUN_SOURCE,
  });
}

export { fetchRunPageIPC, getRunIPC, rerunIPC };
