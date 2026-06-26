import type { Completion } from "@codemirror/autocomplete";

interface DbtColumnEntry {
  name: string;
  description?: string;
  type?: string;
}

interface DbtModelEntry {
  name: string;
  columns?: DbtColumnEntry[];
}

interface DbtSourceEntry {
  sourceName: string;
  tableName: string;
  columns?: DbtColumnEntry[];
}

interface DbtMacroEntry {
  name: string;
}

type DbtContextType = "ref" | "source-name" | "source-table" | "from-join" | "template";

type TemplateBlock = "expression" | "statement";

interface DbtContext {
  type: DbtContextType;
  sourceName?: string;
  block?: TemplateBlock;
  prefix: string;
  from: number;
}

// Whether the cursor sits inside an unclosed Jinja `{{ }}` (expression) or
// `{% %}` (statement) block, and which kind. Returns the most recent open
// delimiter's kind, or null if the cursor is in plain SQL.
function openTemplateBlock(before: string): TemplateBlock | null {
  const exprOpen = before.lastIndexOf("{{") > before.lastIndexOf("}}");
  const stmtOpen = before.lastIndexOf("{%") > before.lastIndexOf("%}");
  if (exprOpen && before.lastIndexOf("{{") >= before.lastIndexOf("{%")) return "expression";
  if (stmtOpen) return "statement";
  if (exprOpen) return "expression";
  return null;
}

function detectDbtContext(text: string, pos: number): DbtContext | null {
  const before = text.slice(0, pos);

  // ref context: {{ ref('prefix
  const refMatch = before.match(/\{\{\s*ref\(\s*['"]([^'"]*)$/);
  if (refMatch) {
    const prefix = refMatch[1];
    return { type: "ref", prefix, from: pos - prefix.length };
  }

  // source second-arg context: {{ source('name', 'prefix
  const sourceTableMatch = before.match(/\{\{\s*source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)$/);
  if (sourceTableMatch) {
    const sourceName = sourceTableMatch[1];
    const prefix = sourceTableMatch[2];
    return { type: "source-table", sourceName, prefix, from: pos - prefix.length };
  }

  // source first-arg context: {{ source('prefix
  const sourceNameMatch = before.match(/\{\{\s*source\(\s*['"]([^'"]*)$/);
  if (sourceNameMatch) {
    const prefix = sourceNameMatch[1];
    return { type: "source-name", prefix, from: pos - prefix.length };
  }

  // template context: a bare identifier anywhere inside an open `{{ }}` or
  // `{% %}` block (ref/source are handled above once their `(` is typed). Covers
  // dbt builtins and, in statement blocks, Jinja control keywords.
  const block = openTemplateBlock(before);
  if (block) {
    const prefix = before.match(/(\w*)$/)![1];
    return { type: "template", block, prefix, from: pos - prefix.length };
  }

  // FROM/JOIN context (case-insensitive)
  const fromJoinMatch = before.match(/(?:FROM|JOIN)\s+(\w*)$/i);
  if (fromJoinMatch) {
    const prefix = fromJoinMatch[1];
    return { type: "from-join", prefix, from: pos - prefix.length };
  }

  return null;
}

function buildRefCompletions(models: DbtModelEntry[], prefix: string): Completion[] {
  return models
    .filter((m) => m.name.startsWith(prefix))
    .map((m) => ({ label: m.name, type: "variable", boost: 10 }));
}

function buildSourceCompletions(
  sources: DbtSourceEntry[],
  ctxType: "source-name" | "source-table",
  sourceName: string | undefined,
  prefix: string,
): Completion[] {
  if (ctxType === "source-name") {
    const seen = new Set<string>();
    const completions: Completion[] = [];
    for (const s of sources) {
      if (!seen.has(s.sourceName) && s.sourceName.startsWith(prefix)) {
        seen.add(s.sourceName);
        completions.push({ label: s.sourceName, type: "variable", boost: 10 });
      }
    }
    return completions;
  }

  // source-table
  return sources
    .filter((s) => s.sourceName === sourceName && s.tableName.startsWith(prefix))
    .map((s) => ({ label: s.tableName, type: "variable", boost: 10 }));
}

// dbt Jinja context available inside `{{ }}` / `{% %}` blocks, offered alongside
// user-defined macros so built-ins aren't flagged as unknown. These are
// the dbt runtime spec + Jinja grammar: fixed sets that don't vary per project,
// unlike user macros (which come from the parsed project via `dbtMacros`).
const DBT_BUILTIN_VARIABLES = [
  "this", "target", "model", "schema", "database", "adapter", "builtins",
  "dbt_version", "flags", "invocation_id", "run_started_at", "modules", "graph",
];
const DBT_BUILTIN_FUNCTIONS = [
  "ref", "source", "config", "var", "env_var", "is_incremental", "doc", "log",
  "print", "return", "run_query", "statement", "fromjson", "tojson", "fromyaml",
  "toyaml", "as_text", "as_bool", "as_number", "as_native", "zip",
];
// Jinja control keywords, only meaningful inside `{% %}` statement blocks.
const JINJA_KEYWORDS = [
  "if", "elif", "else", "endif", "for", "endfor", "in", "set", "endset",
  "macro", "endmacro", "call", "endcall", "filter", "endfilter", "block",
  "endblock", "with", "endwith", "raw", "endraw", "do", "is", "not", "and",
  "or", "none", "true", "false", "loop",
];

function buildTemplateCompletions(
  macros: DbtMacroEntry[],
  prefix: string,
  block: TemplateBlock,
): Completion[] {
  const userMacros = macros.filter((m) => m.name.startsWith(prefix));
  const taken = new Set(userMacros.map((m) => m.name));
  const completions: Completion[] = userMacros.map((m) => ({
    label: m.name, type: "function", boost: 10,
  }));
  const push = (names: string[], type: string, boost: number) => {
    for (const name of names) {
      if (name.startsWith(prefix) && !taken.has(name)) {
        taken.add(name);
        completions.push({ label: name, type, boost });
      }
    }
  };
  if (block === "statement") push(JINJA_KEYWORDS, "keyword", 6);
  push(DBT_BUILTIN_FUNCTIONS, "function", 5);
  push(DBT_BUILTIN_VARIABLES, "variable", 5);
  return completions;
}

function buildFromJoinCompletions(
  models: DbtModelEntry[],
  sources: DbtSourceEntry[],
  prefix: string,
): Completion[] {
  const completions: Completion[] = [];

  for (const m of models) {
    if (m.name.startsWith(prefix)) {
      completions.push({
        label: m.name,
        apply: `{{ ref('${m.name}') }}`,
        type: "variable",
        boost: 10,
      });
    }
  }

  for (const s of sources) {
    const label = `${s.sourceName}.${s.tableName}`;
    if (label.startsWith(prefix)) {
      completions.push({
        label,
        apply: `{{ source('${s.sourceName}', '${s.tableName}') }}`,
        type: "variable",
        boost: 5,
      });
    }
  }

  return completions;
}

export {
  buildFromJoinCompletions,
  buildTemplateCompletions,
  buildRefCompletions,
  buildSourceCompletions,
  detectDbtContext,
};

export type {
  DbtColumnEntry,
  DbtContext,
  DbtContextType,
  DbtMacroEntry,
  DbtModelEntry,
  DbtSourceEntry,
  TemplateBlock,
};
