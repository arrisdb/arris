import type { QueryValue } from "@shared";
import type { VisibleResultRow } from "../ResultsTableView/types";
import {
  NO_ROWS_LABEL,
  ROWS_FROM_TOKEN,
  ROWS_RANGE_TEMPLATE,
  ROWS_TO_TOKEN,
  ROWS_TOTAL_TOKEN,
} from "./constants";

function toVisibleRows(rows: QueryValue[][]): VisibleResultRow[] {
  return rows.map((row, originalIndex) => ({ row, originalIndex }));
}

// One-based inclusive range, e.g. "rows 101 to 200 of 250"; an empty page reads "No rows".
function formatRowRange(offset: number, count: number, total: number): string {
  if (count === 0) return NO_ROWS_LABEL;
  return ROWS_RANGE_TEMPLATE.replace(ROWS_FROM_TOKEN, String(offset + 1))
    .replace(ROWS_TO_TOKEN, String(offset + count))
    .replace(ROWS_TOTAL_TOKEN, String(total));
}

export { formatRowRange, toVisibleRows };
