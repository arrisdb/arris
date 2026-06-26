import type { ColumnSpec, QueryValue } from "./types";

// A string is worth parsing only if it looks like a JSON object or array.
// This avoids turning plain strings (dates, URLs, numeric text) into anything
// other than themselves.
function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (first === "{" && last === "}") || (first === "[" && last === "]");
}

// Recursively expand any stringified JSON found anywhere in the value so the
// detail view renders nested objects instead of escaped strings. Walks into
// arrays and objects so deeply-nested stringified JSON (e.g. a JSON string
// inside an already-parsed object) is expanded too.
function deepParse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepParse);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = deepParse(inner);
    }
    return out;
  }
  if (typeof value === "string" && looksLikeJson(value)) {
    try {
      return deepParse(JSON.parse(value));
    } catch {
      return value;
    }
  }
  return value;
}

// Exact decimals (SQL NUMERIC/DECIMAL) arrive as digit strings. We render them
// as unquoted JSON number literals (preserving trailing zeros and arbitrary
// precision) by wrapping the digits in a sentinel before JSON.stringify, then
// stripping the quotes (and sentinel) it adds. The sentinel survives stringify
// untouched because it contains no characters JSON escapes.
const DECIMAL_PREFIX = "@@DECIMAL_";
const DECIMAL_SUFFIX = "_LAMICED@@";
const DECIMAL_UNWRAP = new RegExp(
  `"${DECIMAL_PREFIX}([-+0-9.eE]*)${DECIMAL_SUFFIX}"`,
  "g",
);

// Only digit strings that are already valid JSON numbers can be emitted
// unquoted. Anything else (e.g. Postgres NUMERIC 'NaN'/'Infinity') stays a
// quoted string so the rendered document remains valid JSON.
function isJsonNumber(text: string): boolean {
  return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text);
}

function rowToJson(columns: ColumnSpec[], row: QueryValue[] | null): string {
  if (!row) return "";
  const obj: Record<string, unknown> = {};
  columns.forEach((column, index) => {
    const value = row[index];
    if (!value || value.kind === "null") {
      obj[column.name] = null;
      return;
    }
    if (value.kind === "decimal") {
      const digits = String(value.value ?? "");
      obj[column.name] = isJsonNumber(digits)
        ? `${DECIMAL_PREFIX}${digits}${DECIMAL_SUFFIX}`
        : digits;
      return;
    }
    obj[column.name] = deepParse(value.value);
  });
  return JSON.stringify(obj, null, 2).replace(DECIMAL_UNWRAP, "$1");
}

// The read-only JSON editor is non-editable (contenteditable=false), so its
// content can't take keyboard focus and a native Cmd/Ctrl+A bubbles to the
// browser, selecting the whole IDE instead of the panel. The panel detects the
// combo so it can swallow it and scope the selection itself.
function isSelectAllShortcut(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  return (event.metaKey || event.ctrlKey) && (event.key === "a" || event.key === "A");
}

// Select every line of JSON rendered in the row-detail host. Targets the
// CodeMirror content node so the line-number gutter stays out of the selection;
// falls back to the host itself when the editor DOM isn't mounted yet. Returns
// the element whose contents were selected.
function selectJsonText(host: HTMLElement): HTMLElement {
  const target = (host.querySelector(".cm-content") as HTMLElement | null) ?? host;
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return target;
}

export { isSelectAllShortcut, rowToJson, selectJsonText };
