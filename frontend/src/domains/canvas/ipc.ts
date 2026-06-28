import { invoke } from "@tauri-apps/api/core";
import type { QueryLanguage, QueryResult, QueryValue } from "@shared";

/// Row cap pulled for a board query object. Charts buffer the whole result, so a
/// bound keeps a careless `SELECT *` from dragging the board down; `has_more`
/// on the result signals truncation.
const CANVAS_QUERY_PAGE_SIZE = 1000;

/// Run a query object's SQL against its connection and return the first page of
/// rows. Reuses the same `cmd_run_query` command the editor/results grid use.
function runCanvasQueryIPC(
  connectionId: string,
  sql: string,
  language?: QueryLanguage,
): Promise<QueryResult> {
  return invoke("cmd_run_query", {
    connectionId,
    sql,
    params: [] as QueryValue[],
    language,
    pageSize: CANVAS_QUERY_PAGE_SIZE,
    page: 0,
  });
}

export { runCanvasQueryIPC };
