import type { ResultSortClause } from "@domains/results";

import { TIMESTAMP_PAD_CHAR, TIMESTAMP_PAD_WIDTH } from "./constants";

function pad(n: number): string {
  return String(n).padStart(TIMESTAMP_PAD_WIDTH, TIMESTAMP_PAD_CHAR);
}

// The last-refresh wall-clock as "YYYY-MM-DD HH:MM:SS" (matches the query cell's
// timestamp), or "" when the source has not settled yet.
function formatTimestamp(epochMs: number | undefined): string {
  if (epochMs === undefined) return "";
  const d = new Date(epochMs);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${date} ${time}`;
}

// Total page count for a full row total, never below one (an empty result still
// shows "Page 1/1").
function pageCountFor(totalRows: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalRows / pageSize));
}

// Single-column sort cycle on a header click: unsorted -> asc -> desc -> unsorted.
// The grid is one page at a time, so one active sort key is enough.
function nextSortClauses(
  current: ResultSortClause[],
  column: string,
): ResultSortClause[] {
  const active = current[0];
  if (!active || active.column !== column) return [{ column, direction: "asc" }];
  if (active.direction === "asc") return [{ column, direction: "desc" }];
  return [];
}

interface TableStatusInput {
  totalRows: number;
  columnCount: number;
  pageIndex: number;
  pageCount: number;
  endedAt: number | undefined;
}

// The footer summary: "N rows · M columns · Page P/Q · YYYY-MM-DD HH:MM:SS".
// The timestamp segment is dropped until the source has settled.
function tableStatusSummary({
  totalRows,
  columnCount,
  pageIndex,
  pageCount,
  endedAt,
}: TableStatusInput): string {
  const rows = `${totalRows.toLocaleString()} row${totalRows === 1 ? "" : "s"}`;
  const cols = `${columnCount} column${columnCount === 1 ? "" : "s"}`;
  const page = `Page ${pageIndex + 1}/${pageCount}`;
  const stamp = formatTimestamp(endedAt);
  return [rows, cols, page, ...(stamp ? [stamp] : [])].join(" · ");
}

export { formatTimestamp, nextSortClauses, pageCountFor, tableStatusSummary };
export type { TableStatusInput };
