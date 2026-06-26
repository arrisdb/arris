// Pure jinja-reference parsing for dbt go-to-definition: identify the `ref` /
// `source` / `doc` / macro call under the cursor and locate a definition offset
// in an opened file. No project/store/domain knowledge; that lives in the
// editor domain's `dbtNavigation` (node resolution). Kept dependency-free so it
// can be shared editor infrastructure.

// A jinja reference under the cursor that supports cmd+click go-to-definition.
type DbtReference =
  | { kind: "ref"; name: string }
  | { kind: "source"; sourceName: string; tableName: string }
  | { kind: "macro"; name: string }
  | { kind: "doc"; name: string };

// Jinja callables that are NOT macros: never resolve these as macro nav.
const JINJA_BUILTINS: ReadonlySet<string> = new Set([
  "ref",
  "source",
  "doc",
  "config",
  "var",
  "env_var",
  "return",
  "run_query",
  "statement",
  "log",
  "print",
  "is_incremental",
  "load_result",
  "adapter",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findClosingParen(text: string, openParen: number): number {
  let quote: "'" | "\"" | null = null;
  for (let i = openParen + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\" && i + 1 < text.length) {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
    } else if (ch === ")") {
      return i;
    }
  }
  return -1;
}

function quotedArgs(args: string): string[] {
  const out: string[] = [];
  const quotePattern = /(['"])((?:\\.|(?!\1).)*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = quotePattern.exec(args)) !== null) {
    out.push(match[2].replace(/\\(['"\\])/g, "$1"));
  }
  return out;
}

// Find the `name(...)` call matching `pattern` whose parentheses enclose `pos`,
// returning its quoted string arguments. Used for ref/source/doc lookups.
function enclosingCallArgs(text: string, pos: number, pattern: RegExp): string[] | null {
  const safePos = Math.max(0, Math.min(pos, text.length));
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const openParen = text.indexOf("(", match.index);
    if (openParen < 0) continue;
    const closeParen = findClosingParen(text, openParen);
    if (closeParen < 0) continue;
    if (safePos < match.index || safePos > closeParen) continue;
    return quotedArgs(text.slice(openParen + 1, closeParen));
  }
  return null;
}

// Resolve the jinja block (`{{ ... }}` or `{% ... %}`) containing `pos`, if any.
function jinjaBlockAround(text: string, pos: number): { start: number; inner: string } | null {
  const safePos = Math.max(0, Math.min(pos, text.length));
  const open = Math.max(text.lastIndexOf("{{", safePos), text.lastIndexOf("{%", safePos));
  if (open < 0) return null;
  const closeToken = text[open + 1] === "{" ? "}}" : "%}";
  const close = text.indexOf(closeToken, open + 2);
  if (close < 0 || safePos > close + closeToken.length) return null;
  const innerStart = open + 2;
  return { start: innerStart, inner: text.slice(innerStart, close) };
}

// Find a non-builtin `name(...)` macro call inside the jinja block at `pos`.
function macroNameAt(text: string, pos: number): string | null {
  const block = jinjaBlockAround(text, pos);
  if (!block) return null;
  const callPattern = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(block.inner)) !== null) {
    const name = match[1];
    if (JINJA_BUILTINS.has(name)) continue;
    const openParen = block.inner.indexOf("(", match.index);
    const closeParen = findClosingParen(block.inner, openParen);
    if (closeParen < 0) continue;
    const absStart = block.start + match.index;
    const absClose = block.start + closeParen;
    if (pos < absStart || pos > absClose) continue;
    return name;
  }
  return null;
}

// Identify the jinja reference under the cursor, in precedence order:
// ref → source → doc → macro.
function dbtReferenceAt(text: string, pos: number): DbtReference | null {
  const refArgs = enclosingCallArgs(text, pos, /\bref\s*\(/g);
  if (refArgs) {
    const name = refArgs[refArgs.length - 1];
    return name ? { kind: "ref", name } : null;
  }
  const sourceArgs = enclosingCallArgs(text, pos, /\bsource\s*\(/g);
  if (sourceArgs && sourceArgs.length >= 2) {
    return { kind: "source", sourceName: sourceArgs[0], tableName: sourceArgs[1] };
  }
  const docArgs = enclosingCallArgs(text, pos, /\bdoc\s*\(/g);
  if (docArgs && docArgs[0]) {
    return { kind: "doc", name: docArgs[0] };
  }
  const macro = macroNameAt(text, pos);
  if (macro) return { kind: "macro", name: macro };
  return null;
}

// Locate the definition offset of a reference within its opened target file, so
// the editor can place the cursor on the definition. Models open at the top.
function dbtDefinitionOffset(text: string, reference: DbtReference): number | undefined {
  if (reference.kind === "macro") {
    const re = new RegExp(`\\{%-?\\s*macro\\s+${escapeRegExp(reference.name)}\\s*\\(`);
    const match = re.exec(text);
    return match ? match.index : undefined;
  }
  if (reference.kind === "doc") {
    const re = new RegExp(`\\{%-?\\s*docs\\s+${escapeRegExp(reference.name)}\\s*-?%\\}`);
    const match = re.exec(text);
    return match ? match.index : undefined;
  }
  if (reference.kind === "source") {
    const re = new RegExp(`-\\s*name:\\s*['"]?${escapeRegExp(reference.tableName)}\\b`);
    const match = re.exec(text);
    return match ? match.index : undefined;
  }
  return undefined;
}

function fileNameForPath(path: string): string {
  return path.split("/").pop() ?? path;
}

export {
  dbtDefinitionOffset,
  dbtReferenceAt,
  fileNameForPath,
};

export type { DbtReference };
