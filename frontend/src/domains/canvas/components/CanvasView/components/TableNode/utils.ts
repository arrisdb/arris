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
  /// The 1-based index of the last row shown on the current page.
  rangeEnd: number;
  endedAt: number | undefined;
}

// The footer summary: "Page P · X of N rows · M columns · YYYY-MM-DD HH:MM:SS".
// The timestamp segment is dropped until the source has settled.
function tableStatusSummary({
  totalRows,
  columnCount,
  pageIndex,
  rangeEnd,
  endedAt,
}: TableStatusInput): string {
  const page = `Page ${pageIndex + 1}`;
  const rows = `${rangeEnd.toLocaleString()} of ${totalRows.toLocaleString()} row${totalRows === 1 ? "" : "s"}`;
  const cols = `${columnCount} column${columnCount === 1 ? "" : "s"}`;
  const stamp = formatTimestamp(endedAt);
  return [page, rows, cols, ...(stamp ? [stamp] : [])].join(" · ");
}

export { formatTimestamp, nextSortClauses, tableStatusSummary };
export type { TableStatusInput };
