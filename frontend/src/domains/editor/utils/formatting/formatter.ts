import { format as formatSql, type SqlLanguage } from "sql-formatter";
import { parseAllDocuments } from "yaml";
import { EditorView } from "@codemirror/view";
import type {
  CommaPosition,
  CsvDelimiter,
  DatabaseKind,
  FormatterSettings,
  MarkdownListMarker,
} from "@shared";
import { useSettingsStore } from "@shared/settings";
import { EditorFormatter, type EditorFormatContext } from "./types";

const TEMPLATE_TOKEN = /ARRIS_TPL_(\d+)_X/gi;

// dbt/SQLMesh templating is always protected: Jinja blocks and SQLMesh `@macros`
// are masked before sql-formatter runs and restored afterwards so they are never
// mangled.
const TEMPLATE_PATTERNS = [
  /\{\{[\s\S]*?\}\}/g,
  /\{%[\s\S]*?%\}/g,
  /\{#[\s\S]*?#\}/g,
  /@\w+(?:\([^)]*\))?/g,
];

function maskTemplating(text: string): {
  masked: string;
  restore: (out: string) => string;
} {
  const spans: string[] = [];
  let masked = text;
  for (const pattern of TEMPLATE_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      const token = `ARRIS_TPL_${spans.length}_X`;
      spans.push(match);
      return token;
    });
  }
  // sql-formatter may recase the placeholder identifier, so restore case-insensitively.
  const restore = (out: string) =>
    out.replace(TEMPLATE_TOKEN, (_token, index: string) => spans[Number(index)] ?? "");
  return { masked, restore };
}

function applyCommaPosition(text: string, position: CommaPosition): string {
  // sql-formatter emits trailing commas; nothing to do for the default.
  if (position === "trailing") return text;
  const lines = text.split("\n");
  const pending = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].replace(/\s+$/, "").endsWith(",")) continue;
    let next = i + 1;
    while (next < lines.length && lines[next].trim() === "") next++;
    if (next >= lines.length) continue;
    lines[i] = lines[i].replace(/\s*,\s*$/, "");
    pending[next] = true;
  }
  for (let i = 0; i < lines.length; i++) {
    if (!pending[i]) continue;
    const match = lines[i].match(/^(\s*)(.*)$/);
    if (match) lines[i] = `${match[1]}, ${match[2]}`;
  }
  return lines.join("\n");
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortJsonKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

function csvDelimiterChar(delimiter: CsvDelimiter): string {
  switch (delimiter) {
    case "semicolon":
      return ";";
    case "tab":
      return "\t";
    case "pipe":
      return "|";
    default:
      return ",";
  }
}

function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function emitCsvField(value: string, delimiter: string, quoteAll: boolean): string {
  const needsQuote =
    quoteAll || value.includes(delimiter) || value.includes('"') || value.includes("\n");
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

function sqlFormatterLanguage(connectionKind?: DatabaseKind): SqlLanguage {
  switch (connectionKind) {
    case "postgres":
      return "postgresql";
    case "mysql":
      return "mysql";
    case "mariadb":
      return "mariadb";
    case "sqlite":
      return "sqlite";
    case "bigquery":
      return "bigquery";
    case "redshift":
      return "redshift";
    case "snowflake":
      return "snowflake";
    case "mssql":
      return "transactsql";
    case "duckdb":
      return "duckdb";
    case "clickhouse":
      return "clickhouse";
    case "oracle":
      return "plsql";
    default:
      return "sql";
  }
}

type ColumnAlign = "left" | "right" | "center" | "none";

function markdownListMarkerChar(marker: MarkdownListMarker): string {
  switch (marker) {
    case "asterisk":
      return "*";
    case "plus":
      return "+";
    default:
      return "-";
  }
}

/// Split a GFM table row into trimmed cell strings, dropping the outer pipes.
/// A backslash-escaped pipe (`\|`) stays part of the cell.
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += s[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

/// A GFM table delimiter row: every cell is dashes with optional alignment
/// colons (e.g. `:---`, `---:`, `:--:`).
function isTableDelimiterRow(line: string): boolean {
  if (!line.includes("-")) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

function columnAlignFromDelimiter(cell: string): ColumnAlign {
  const t = cell.trim();
  const left = t.startsWith(":");
  const right = t.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

function padCell(text: string, width: number, align: ColumnAlign): string {
  const pad = width - text.length;
  if (pad <= 0) return text;
  if (align === "right") return " ".repeat(pad) + text;
  if (align === "center") {
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + text + " ".repeat(pad - left);
  }
  return text + " ".repeat(pad);
}

/// Render a delimiter cell of the given width, keeping the colons that signal
/// alignment. GFM requires at least one dash.
function delimiterCell(width: number, align: ColumnAlign): string {
  switch (align) {
    case "left":
      return `:${"-".repeat(Math.max(1, width - 1))}`;
    case "right":
      return `${"-".repeat(Math.max(1, width - 1))}:`;
    case "center":
      return `:${"-".repeat(Math.max(1, width - 2))}:`;
    default:
      return "-".repeat(Math.max(1, width));
  }
}

/// Reformat one GFM table (header row, delimiter row, body rows) so every
/// column is padded to a common width and the delimiter carries alignment.
function formatMarkdownTable(rows: string[]): string[] {
  const header = splitTableRow(rows[0]);
  const aligns = splitTableRow(rows[1]).map(columnAlignFromDelimiter);
  const body = rows.slice(2).map(splitTableRow);
  const cols = header.length;
  const widths = new Array<number>(cols).fill(0);
  const cellAt = (cells: string[], i: number) => cells[i] ?? "";
  const measure = (cells: string[]) => {
    for (let i = 0; i < cols; i++) widths[i] = Math.max(widths[i], cellAt(cells, i).length, 3);
  };
  measure(header);
  body.forEach(measure);
  const renderRow = (cells: string[]) =>
    `| ${header.map((_, i) => padCell(cellAt(cells, i), widths[i], aligns[i] ?? "none")).join(" | ")} |`;
  const delimiterRow = `| ${widths.map((w, i) => delimiterCell(w, aligns[i] ?? "none")).join(" | ")} |`;
  return [renderRow(header), delimiterRow, ...body.map(renderRow)];
}

class SqlFormatter extends EditorFormatter {
  constructor() {
    super(["sql", "kafka", "esql", "redis", "mongodb"]);
  }

  format(context: EditorFormatContext): string {
    const s = context.settings.sql;
    const { masked, restore } = maskTemplating(context.text);
    const formatted = formatSql(masked, {
      language: sqlFormatterLanguage(context.connectionKind),
      keywordCase: s.keywordCase,
      identifierCase: s.identifierCase,
      dataTypeCase: s.dataTypeCase,
      functionCase: s.functionCase,
      indentStyle: s.indentStyle,
      tabWidth: s.tabWidth,
      useTabs: s.useTabs,
      logicalOperatorNewline: s.logicalOperatorNewline,
      expressionWidth: s.expressionWidth,
      linesBetweenQueries: s.linesBetweenQueries,
      denseOperators: s.denseOperators,
      newlineBeforeSemicolon: s.newlineBeforeSemicolon,
    });
    return applyCommaPosition(restore(formatted), s.commaPosition);
  }
}

class PythonFormatter extends EditorFormatter {
  constructor() {
    super(["python"]);
  }

  format(context: EditorFormatContext): string {
    const s = context.settings.python;
    const indent = " ".repeat(s.indentWidth);
    const lines = context.text.replace(/\r\n/g, "\n").split("\n").map((line) => {
      const leadingTabs = line.match(/^\t+/);
      const converted = leadingTabs
        ? indent.repeat(leadingTabs[0].length) + line.slice(leadingTabs[0].length)
        : line;
      return s.trimTrailingWhitespace ? converted.replace(/[ \t]+$/, "") : converted;
    });
    const collapsed: string[] = [];
    let blanks = 0;
    for (const line of lines) {
      if (line === "") {
        blanks++;
        if (blanks <= s.maxBlankLines) collapsed.push(line);
      } else {
        blanks = 0;
        collapsed.push(line);
      }
    }
    while (collapsed.length > 0 && collapsed[0] === "") collapsed.shift();
    while (collapsed.length > 0 && collapsed[collapsed.length - 1] === "") collapsed.pop();
    return `${collapsed.join("\n")}\n`;
  }
}

class JsonFormatter extends EditorFormatter {
  constructor() {
    super(["json"]);
  }

  format(context: EditorFormatContext): string {
    const s = context.settings.json;
    const parsed: unknown = JSON.parse(context.text);
    const value = s.sortKeys ? sortJsonKeys(parsed) : parsed;
    const indent = s.useTabs ? "\t" : s.indentWidth;
    return `${JSON.stringify(value, null, indent)}\n`;
  }
}

class YamlFormatter extends EditorFormatter {
  constructor() {
    super(["yaml"]);
  }

  format(context: EditorFormatContext): string {
    const s = context.settings.yaml;
    const docs = parseAllDocuments(context.text);
    return docs.map((doc) => doc.toString({ indent: s.indentWidth })).join("");
  }
}

class CsvFormatter extends EditorFormatter {
  constructor() {
    super(["csv"]);
  }

  format(context: EditorFormatContext): string {
    const s = context.settings.csv;
    const delimiter = csvDelimiterChar(s.delimiter);
    const rows = parseCsvRows(context.text, delimiter);
    return `${rows
      .map((row) =>
        row
          .map((field) =>
            emitCsvField(s.trimFields ? field.trim() : field, delimiter, s.quoteAllFields),
          )
          .join(delimiter),
      )
      .join("\n")}\n`;
  }
}

class MarkdownFormatter extends EditorFormatter {
  constructor() {
    super(["markdown"]);
  }

  format(context: EditorFormatContext): string {
    const s = context.settings.markdown;
    const marker = markdownListMarkerChar(s.listMarker);
    const lines = context.text.replace(/\r\n/g, "\n").split("\n");
    const out: string[] = [];
    let inFence = false;
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        out.push(line);
        i += 1;
        continue;
      }
      if (inFence) {
        out.push(line);
        i += 1;
        continue;
      }
      // A table is a row followed by a delimiter row; consume the whole block.
      if (line.includes("|") && i + 1 < lines.length && isTableDelimiterRow(lines[i + 1])) {
        const block = [line, lines[i + 1]];
        i += 2;
        while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "" && !/^\s*```/.test(lines[i])) {
          block.push(lines[i]);
          i += 1;
        }
        out.push(...formatMarkdownTable(block));
        continue;
      }
      let result = line;
      const heading = /^(#{1,6})\s+(.*)$/.exec(result);
      if (heading) result = `${heading[1]} ${heading[2]}`;
      const list = /^(\s*)[-*+](\s+)(.*)$/.exec(result);
      if (list) result = `${list[1]}${marker}${list[2]}${list[3]}`;
      if (s.trimTrailingWhitespace) result = result.replace(/[ \t]+$/, "");
      out.push(result);
      i += 1;
    }
    while (out.length > 0 && out[out.length - 1] === "") out.pop();
    return `${out.join("\n")}\n`;
  }
}

const FORMATTERS: readonly EditorFormatter[] = [
  new SqlFormatter(),
  new PythonFormatter(),
  new JsonFormatter(),
  new YamlFormatter(),
  new CsvFormatter(),
  new MarkdownFormatter(),
];

function formatEditorText(
  text: string,
  languageId: string,
  connectionKind?: DatabaseKind,
  settings?: FormatterSettings,
): string {
  if (!text.trim()) return text;
  const formatter = FORMATTERS.find((candidate) => candidate.supports(languageId));
  if (!formatter) return text;
  return formatter.format({
    text,
    languageId,
    connectionKind,
    settings: settings ?? useSettingsStore.getState().formatter,
  });
}

function reformatEditorView(
  view: EditorView,
  languageId = view.dom.dataset.arrisLang ?? "sql",
  connectionKind = view.dom.dataset.arrisConnectionKind as DatabaseKind | undefined,
): boolean {
  const current = view.state.doc.toString();
  let formatted: string;
  try {
    formatted = formatEditorText(current, languageId, connectionKind);
  } catch {
    return true;
  }
  if (formatted === current) return true;
  const cursor = Math.min(view.state.selection.main.head, formatted.length);
  view.dispatch({
    changes: { from: 0, to: current.length, insert: formatted },
    selection: { anchor: cursor },
    scrollIntoView: true,
  });
  return true;
}

export {
  formatEditorText,
  reformatEditorView,
};
