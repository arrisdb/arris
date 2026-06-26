import type { NotebookCell, NotebookCellType, NotebookOutput } from "../../../types";

// nbformat v4 raw JSON shapes (https://nbformat.readthedocs.io). `source` and
// stream `text` are stored as either a single string or an array of lines; mime
// `data` values likewise. We preserve those values verbatim so a round-trip
// reproduces the file faithfully.

interface RawNotebook {
  cells?: RawCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
}

interface RawCell {
  cell_type?: string;
  source?: string | string[];
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  outputs?: RawOutput[];
}

// A flat shape covering every nbformat output kind; fields are read per
// `output_type` in `parseOutputs`. A discriminated union narrows badly here
// because the unknown-type fallback would overlap the known variants.
interface RawOutput {
  output_type?: string;
  name?: string;
  text?: string | string[];
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

interface ParsedNotebook {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformatMinor: number;
  execCount: number;
}

let parseCellSeq = 0;
let parseOutputSeq = 0;

function nextCellId(): string {
  parseCellSeq += 1;
  return `nbf-cell-${parseCellSeq}`;
}

function nextOutputId(): string {
  parseOutputSeq += 1;
  return `nbf-out-${parseOutputSeq}`;
}

/// Collapse nbformat's string-or-array source/text into a single string.
function joinSource(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join("");
  return "";
}

/// Split a string back into nbformat's array-of-lines form, where every line
/// keeps its trailing newline except the last. Empty string → empty array.
function splitSource(text: string): string[] {
  if (text === "") return [];
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [text];
}

function normalizeCellType(raw: string | undefined): NotebookCellType {
  return raw === "code" || raw === "markdown" ? raw : "raw";
}

function parseOutputs(raw: RawOutput[] | undefined): NotebookOutput[] {
  if (!Array.isArray(raw)) return [];
  const out: NotebookOutput[] = [];
  for (const o of raw) {
    switch (o.output_type) {
      case "stream":
        out.push({
          id: nextOutputId(),
          outputType: "stream",
          name: o.name === "stderr" ? "stderr" : "stdout",
          text: joinSource(o.text),
        });
        break;
      case "execute_result":
        out.push({
          id: nextOutputId(),
          outputType: "executeResult",
          data: o.data ?? {},
          executionCount: o.execution_count ?? null,
        });
        break;
      case "display_data":
        out.push({ id: nextOutputId(), outputType: "displayData", data: o.data ?? {} });
        break;
      case "error":
        out.push({
          id: nextOutputId(),
          outputType: "error",
          ename: o.ename ?? "",
          evalue: o.evalue ?? "",
          traceback: Array.isArray(o.traceback) ? o.traceback : [],
        });
        break;
      // Unknown output types are dropped; nothing renders them.
    }
  }
  return out;
}

/// SQL-cell tag carried in nbformat cell metadata under `arris`. A cell with
/// `kind === "sql"` is persisted as a `code` cell but rehydrated as a `sql`
/// cell; `connectionId`/`varName` restore the connection picker and bound name.
interface ArrisCellMeta {
  kind?: string;
  connectionId?: string | null;
  varName?: string;
}

function parseCell(raw: RawCell): NotebookCell {
  const meta = { ...(raw.metadata ?? {}) } as Record<string, unknown>;
  const arris = meta.arris as ArrisCellMeta | undefined;
  const isSql = arris?.kind === "sql";
  // The `arris` tag is rebuilt from the cell's own fields on save, so strip it
  // from the preserved metadata to keep a single source of truth.
  if (isSql) delete meta.arris;

  const cellType: NotebookCellType = isSql ? "sql" : normalizeCellType(raw.cell_type);
  const executable = cellType === "code" || cellType === "sql";
  return {
    id: nextCellId(),
    cellType,
    source: joinSource(raw.source),
    outputs: executable ? parseOutputs(raw.outputs) : [],
    executionCount: executable ? raw.execution_count ?? null : null,
    metadata: meta,
    // Markdown opens rendered; code/sql/raw always show their source.
    rendered: cellType === "markdown",
    pendingMsgId: null,
    ...(isSql
      ? {
          sqlConnectionId: arris?.connectionId ?? null,
          sqlVarName: arris?.varName ?? "",
        }
      : {}),
  };
}

/// A blank notebook with a single empty code cell, used for a new/empty/invalid
/// `.ipynb` so the editor always has something to show.
function blankNotebook(): ParsedNotebook {
  return {
    cells: [
      {
        id: nextCellId(),
        cellType: "code",
        source: "",
        outputs: [],
        executionCount: null,
        metadata: {},
        rendered: false,
        pendingMsgId: null,
      },
    ],
    metadata: {},
    nbformatMinor: 5,
    execCount: 0,
  };
}

function serializeOutput(output: NotebookOutput): RawOutput {
  switch (output.outputType) {
    case "stream":
      return { output_type: "stream", name: output.name, text: splitSource(output.text) };
    case "executeResult":
      return {
        output_type: "execute_result",
        data: output.data,
        metadata: {},
        execution_count: output.executionCount,
      };
    case "displayData":
      return { output_type: "display_data", data: output.data, metadata: {} };
    case "error":
      return {
        output_type: "error",
        ename: output.ename,
        evalue: output.evalue,
        traceback: output.traceback,
      };
  }
}

function serializeCell(cell: NotebookCell): RawCell {
  const isSql = cell.cellType === "sql";
  // SQL cells persist as nbformat `code` cells tagged via `metadata.arris`, so
  // the file stays valid nbformat and round-trips back into a SQL cell.
  const metadata = isSql
    ? {
        ...cell.metadata,
        arris: {
          kind: "sql",
          connectionId: cell.sqlConnectionId ?? null,
          varName: cell.sqlVarName ?? "",
        },
      }
    : cell.metadata;
  const base: RawCell = {
    cell_type: isSql ? "code" : cell.cellType,
    metadata,
    source: splitSource(cell.source),
  };
  if (cell.cellType === "code" || isSql) {
    base.execution_count = cell.executionCount;
    base.outputs = cell.outputs.map(serializeOutput);
  }
  return base;
}

/// Parse `.ipynb` text into the notebook document model. Tolerant of empty or
/// malformed input: returns a blank single-cell notebook rather than throwing,
/// so opening a freshly-created file just works.
function parseNotebook(text: string): ParsedNotebook {
  let raw: RawNotebook;
  try {
    raw = JSON.parse(text) as RawNotebook;
  } catch {
    return blankNotebook();
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.cells)) {
    return blankNotebook();
  }
  const cells = raw.cells.map(parseCell);
  if (cells.length === 0) return blankNotebook();
  const execCount = cells.reduce(
    (max, c) => (c.executionCount && c.executionCount > max ? c.executionCount : max),
    0,
  );
  return {
    cells,
    metadata: raw.metadata ?? {},
    nbformatMinor: raw.nbformat_minor ?? 5,
    execCount,
  };
}

/// Serialize the notebook document back to nbformat v4 `.ipynb` text (1-space
/// indented, trailing newline, matching Jupyter's own writer).
function serializeNotebook(doc: {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformatMinor: number;
}): string {
  const raw: RawNotebook = {
    cells: doc.cells.map(serializeCell),
    metadata: doc.metadata,
    nbformat: 4,
    nbformat_minor: doc.nbformatMinor,
  };
  return `${JSON.stringify(raw, null, 1)}\n`;
}

export { parseNotebook, serializeNotebook };
export type { ParsedNotebook };
