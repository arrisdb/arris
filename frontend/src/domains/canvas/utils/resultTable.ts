import type { QueryResult, QueryValue } from "@shared";

// One wide cell must not blow the agent's context, so each cell is capped.
const MAX_CELL_CHARS = 200;
// Cap the rows handed to the agent: enough to reason over, not a full dump.
const MAX_SHARE_ROWS = 50;

/// Render one result cell as a single-line, pipe-safe string. Nulls become NULL
/// so the model can tell them apart from empty strings.
function formatCell(cell: QueryValue): string {
  if (!cell || cell.kind === "null" || cell.value == null) return "NULL";
  let text = String(cell.value).replace(/\s+/g, " ").replace(/\|/g, "\\|");
  if (text.length > MAX_CELL_CHARS) text = `${text.slice(0, MAX_CELL_CHARS)}…`;
  return text;
}

/// Serialize a query object's result into a compact markdown table for the agent,
/// with column types in the header so it knows what it is reasoning over. Rows are
/// capped; a truncation note is appended when the cap bites.
function serializeResultTable(result: QueryResult): {
  table: string;
  rowCount: number;
  colCount: number;
} {
  const header = result.columns.map((c) => `${c.name} (${c.type_hint})`);
  const shown = result.rows.slice(0, MAX_SHARE_ROWS);
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${result.columns.map(() => "---").join(" | ")} |`,
    ...shown.map((row) => `| ${row.map(formatCell).join(" | ")} |`),
  ];
  if (result.rows.length > shown.length) {
    lines.push(`| …${result.rows.length - shown.length} more rows |`);
  }
  return {
    table: lines.join("\n"),
    rowCount: shown.length,
    colCount: result.columns.length,
  };
}

export { serializeResultTable };
