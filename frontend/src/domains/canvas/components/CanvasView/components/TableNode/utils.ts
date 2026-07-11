import type { QueryValue } from "@shared";

/// Render one cell value for the result grid.
function cellText(value: QueryValue): string {
  if (!value || value.kind === "null" || value.value == null) return "NULL";
  return String(value.value);
}

/// "start-end of total" for the pager, 1-based and thousands-separated.
/// `total` is undefined while the source is still streaming (count unknown).
function pageRangeLabel(offset: number, shown: number, total?: number): string {
  if (total === 0) return "0 of 0";
  const start = offset + 1;
  const end = offset + shown;
  const totalPart = total === undefined ? "…" : total.toLocaleString();
  return `${start.toLocaleString()}-${end.toLocaleString()} of ${totalPart}`;
}

export { cellText, pageRangeLabel };
