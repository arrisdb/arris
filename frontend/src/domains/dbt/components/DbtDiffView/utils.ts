import type { QueryValue } from "@shared";

function formatDiffCell(v: QueryValue): string {
  if (!v || v.kind === "null") return "NULL";
  return v.value === undefined ? "" : String(v.value);
}

export { formatDiffCell };
