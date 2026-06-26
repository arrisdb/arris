import { type CellEdit, type PendingInsert } from "../../types";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import type {
  ColumnSpec,
  QueryResult,
  QueryValue,
  QueryValueKind,
  ResultSortClause,
  SelectedCell,
  TableMutationBatch,
  TypeChipFamily,
  TypeChipMeta,
  VisibleResultRow,
} from "./types";
type ExportFormat = "csv" | "json";

interface IpcError {
  code:
    | "invalidArgument"
    | "notConnected"
    | "connectionFailed"
    | "queryFailed"
    | "explainUnsupported"
    | "missingPrimaryKey"
    | "cancelled"
    | "io"
    | "serialization"
    | "other";
  message: string;
}

interface EditingSnapshot {
  edits: Record<string, CellEdit>;
  inserts: PendingInsert[];
  deletes: { tabId: string; rowIndex: number }[];
}

function compareCell(a: QueryValue, b: QueryValue): number {
  const aNull = !a || a.kind === "null" || a.value === undefined;
  const bNull = !b || b.kind === "null" || b.value === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return -1;
  if (bNull) return 1;
  const av = a.value as number | string | boolean;
  const bv = b.value as number | string | boolean;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  return String(av).localeCompare(String(bv));
}

function visibleRowsForResult(
  result: QueryResult | undefined,
  sortClauses: ResultSortClause[],
): VisibleResultRow[] {
  if (!result) return [];
  let rows = result.rows.map((row, originalIndex) => ({
    row,
    originalIndex,
  }));
  if (sortClauses.length > 0) {
    const colIdx = (name: string) =>
      result.columns.findIndex((column) => column.name === name);
    rows = [...rows].sort((a, b) => {
      for (const clause of sortClauses) {
        const columnIndex = colIdx(clause.column);
        if (columnIndex < 0) continue;
        const cmp = compareCell(a.row[columnIndex], b.row[columnIndex]);
        if (cmp !== 0) return clause.direction === "asc" ? cmp : -cmp;
      }
      return 0;
    });
  }
  return rows;
}

function stagedKeysForTab(
  tabId: string | null,
  edits: Record<string, CellEdit>,
): Set<string> {
  if (!tabId) return new Set<string>();
  const keys = new Set<string>();
  for (const key of Object.keys(edits)) {
    if (key.startsWith(`${tabId}:`)) keys.add(key);
  }
  return keys;
}

function deletedRowsForTab(
  tabId: string | null,
  deletes: { tabId: string; rowIndex: number }[],
): Set<number> {
  if (!tabId) return new Set<number>();
  return new Set(
    deletes.filter((deleted) => deleted.tabId === tabId).map((deleted) => deleted.rowIndex),
  );
}

function insertsForTab(
  tabId: string | null,
  inserts: PendingInsert[],
): PendingInsert[] {
  return tabId ? inserts.filter((insert) => insert.tabId === tabId) : [];
}

function typeHintToKind(hint: string): QueryValueKind {
  const h = hint.toLowerCase();
  if (h === "bool" || h === "boolean") return "bool";
  if (/^(int|bigint|smallint|serial|bigserial|tinyint|mediumint|integer)/.test(h)) return "int";
  if (/^(float|double|decimal|numeric|real|money)/.test(h)) return "double";
  if (h === "json" || h === "jsonb") return "json";
  if (h === "bytea" || h === "blob" || h === "binary") return "data";
  return "text";
}

function typeChipFamily(base: string): TypeChipFamily {
  if (/^(bool|boolean|bit)$/.test(base)) return "bool";
  if (/^(uuid|guid|uniqueidentifier)$/.test(base)) return "uuid";
  if (
    /^(int|int2|int4|int8|integer|bigint|smallint|tinyint|mediumint|serial|bigserial|smallserial|oid|long|short|hugeint|uhugeint|ubigint|uinteger|usmallint|utinyint)$/.test(
      base,
    )
  )
    return "int";
  if (/^(numeric|decimal|dec|money|smallmoney|float|float4|float8|double|real|number)$/.test(base))
    return "numeric";
  if (/^(json|jsonb)$/.test(base)) return "json";
  if (
    /^(timestamp|timestamptz|datetime|datetime2|smalldatetime|date|time|timetz|interval|year)$/.test(
      base,
    )
  )
    return "temporal";
  if (/^(bytea|blob|binary|varbinary|bytes|image|raw)$/.test(base)) return "binary";
  if (/(char|text|string|name|citext|clob|enum|set|xml|inet|cidr|macaddr)/.test(base)) return "string";
  return "other";
}

function typeChipMeta(hint: string): TypeChipMeta {
  const trimmed = hint.trim();
  // Strip parameters/modifiers so "numeric(12,2)" and "timestamp with time zone"
  // both classify by their leading base token.
  const base = trimmed
    .toLowerCase()
    .replace(/\s+(with|without)\s+time\s+zone$/, "")
    .replace(/\s+(unsigned|signed)$/, "")
    .split(/[\s(]/)[0];
  return { label: trimmed.toUpperCase(), family: typeChipFamily(base) };
}

function extractIpcError(e: unknown): IpcError {
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, unknown>;
    if (typeof obj.code === "string" && typeof obj.message === "string") {
      return { code: obj.code as IpcError["code"], message: obj.message };
    }
    if (typeof obj.message === "string") {
      return { code: "other", message: obj.message };
    }
    try {
      return { code: "other", message: JSON.stringify(e) };
    } catch {
      return { code: "other", message: "[unknown error]" };
    }
  }
  return { code: "other", message: typeof e === "string" ? e : String(e) };
}

function cellToString(cell: QueryValue | undefined): string {
  if (!cell || cell.kind === "null" || cell.value === undefined) return "";
  if (cell.kind === "bool") return cell.value ? "true" : "false";
  return String(cell.value);
}

// Text to put on the clipboard for the currently-selected cell (Cmd/Ctrl+C in
// the results grid). Honours a staged edit over the original value and uses the
// same `cellToString` rendering as CSV export. Returns null when there is no
// valid selection so the caller leaves the keystroke alone.
function copyTextForSelectedCell(
  rows: VisibleResultRow[],
  columns: ColumnSpec[],
  selectedCell: SelectedCell | null,
  edits: Record<string, { next: QueryValue }>,
  stagedKeys: Set<string>,
  tabId: string | null,
): string | null {
  if (!selectedCell) return null;
  const visibleRow = rows[selectedCell.row];
  if (!visibleRow) return null;
  const cell = visibleRow.row[selectedCell.col];
  if (cell === undefined) return null;
  const columnName = columns[selectedCell.col]?.name ?? `col${selectedCell.col}`;
  const stagedKey = `${tabId}:${visibleRow.originalIndex}:${columnName}`;
  const value = stagedKeys.has(stagedKey) ? edits[stagedKey].next : cell;
  return cellToString(value);
}

// Case-insensitive substring scan over the currently-visible rows only (the
// page already in `rows`), returning each matching cell as a visible-row/column
// coordinate in reading order (row-major). Used by the in-view search bar.
function findVisibleMatches(
  rows: VisibleResultRow[],
  query: string,
): SelectedCell[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: SelectedCell[] = [];
  rows.forEach((visibleRow, row) => {
    visibleRow.row.forEach((cell, col) => {
      if (cellToString(cell).toLowerCase().includes(needle)) {
        matches.push({ row, col });
      }
    });
  });
  return matches;
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function resultToCsv(columns: ColumnSpec[], rows: QueryValue[][]): string {
  const header = columns.map((c) => escapeCsvField(c.name)).join(",");
  const body = rows.map((row) =>
    columns.map((_, ci) => escapeCsvField(cellToString(row[ci]))).join(","),
  );
  return [header, ...body].join("\n");
}

function resultToJson(columns: ColumnSpec[], rows: QueryValue[][]): string {
  const objects = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let ci = 0; ci < columns.length; ci++) {
      const cell = row[ci];
      if (!cell || cell.kind === "null" || cell.value === undefined) {
        obj[columns[ci].name] = null;
      } else {
        obj[columns[ci].name] = cell.value;
      }
    }
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

function tabEditCount(tabId: string, state: EditingSnapshot): number {
  let n = 0;
  for (const key of Object.keys(state.edits)) {
    if (key.startsWith(`${tabId}:`)) n += 1;
  }
  return n + state.inserts.filter((insert) => insert.tabId === tabId).length +
    state.deletes.filter((deleted) => deleted.tabId === tabId).length;
}

function buildBatchForTab(
  tabId: string,
  state: EditingSnapshot,
  resolvePrimaryKey?: (rowIndex: number) => Record<string, QueryValue>,
): TableMutationBatch {
  const updatesByRow = new Map<number, Record<string, QueryValue>>();
  for (const key of Object.keys(state.edits)) {
    if (!key.startsWith(`${tabId}:`)) continue;
    const parts = key.split(":");
    const rowIndex = Number(parts[1]);
    const column = parts.slice(2).join(":");
    const map = updatesByRow.get(rowIndex) ?? {};
    map[column] = state.edits[key].next;
    updatesByRow.set(rowIndex, map);
  }
  const updates = [...updatesByRow.entries()].map(([rowIndex, changes]) => ({
    primary_key: resolvePrimaryKey?.(rowIndex) ?? {},
    changes,
  }));
  const deletes = state.deletes
    .filter((deleted) => deleted.tabId === tabId)
    .map((deleted) => ({ primary_key: resolvePrimaryKey?.(deleted.rowIndex) ?? {} }));
  const inserts = state.inserts
    .filter((insert) => insert.tabId === tabId)
    .map((insert) => ({ values: insert.values }));
  return { updates, inserts, deletes };
}

async function exportResults(
  columns: ColumnSpec[],
  rows: QueryValue[][],
  format: ExportFormat,
): Promise<void> {
  const extension = format === "csv" ? "csv" : "json";
  const filePath = await save({
    title: `Export as ${format.toUpperCase()}`,
    defaultPath: `results.${extension}`,
    filters: [
      {
        name: format.toUpperCase(),
        extensions: [extension],
      },
    ],
  });
  if (!filePath) return;
  const content =
    format === "csv"
      ? resultToCsv(columns, rows)
      : resultToJson(columns, rows);
  await writeTextFile(filePath, content);
}

export {
  buildBatchForTab,
  compareCell,
  copyTextForSelectedCell,
  deletedRowsForTab,
  exportResults,
  extractIpcError,
  findVisibleMatches,
  insertsForTab,
  resultToCsv,
  resultToJson,
  stagedKeysForTab,
  tabEditCount,
  typeChipMeta,
  typeHintToKind,
  visibleRowsForResult,
};
export type { EditingSnapshot, ExportFormat };
