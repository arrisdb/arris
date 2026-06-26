import type { SqlSchemaDict } from "../autocomplete/sqlSchema";
import { findStatementAt } from "./statementHighlight";

interface StarExpansion {
  from: number;
  to: number;
  replacement: string;
  tableName: string;
}

const SQL_BOUNDARY =
  /\b(?:WHERE|GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|WINDOW|ON|SET)\b|;/i;
const SQL_KEYWORDS = new Set([
  "as",
  "where",
  "join",
  "left",
  "right",
  "inner",
  "outer",
  "cross",
  "full",
  "natural",
  "on",
  "group",
  "order",
  "having",
  "limit",
  "offset",
  "union",
]);

function expandStarAtCursor(
  text: string,
  cursor: number,
  schema: SqlSchemaDict,
): StarExpansion | null {
  const star = starRangeAtCursor(text, cursor);
  if (!star) return null;
  const stmt = findStatementAt(text, star.from);
  if (!stmt) return null;
  const statement = text.slice(stmt.from, stmt.to);
  const localStar = star.from - stmt.from;
  if (!isSelectStar(statement, localStar)) return null;
  const qualifier = qualifierBeforeStar(statement, localStar);
  const target = resolveTargetTable(qualifier, statement, localStar, schema);
  if (!target) return null;
  const cols = schema[target.tableName];
  if (!cols?.length) return null;
  const prefix = qualifier ? `${qualifier}.` : "";
  return {
    from: star.from,
    to: star.to,
    replacement: cols.map((c) => `${prefix}${c.name}`).join(", "),
    tableName: target.tableName,
  };
}

// Finds the `*` the cursor/click is on or *next to*. Beyond a direct hit
// (cursor on or immediately after the star), tolerate intervening spaces/tabs
// on either side so right-clicking in the whitespace around `SELECT  *  FROM`
// still resolves the star. Scanning stays inline (no newline hop) so a star
// never grabs across lines/statements.
function starRangeAtCursor(text: string, cursor: number) {
  const pos = Math.max(0, Math.min(cursor, text.length));
  if (text[pos] === "*") return { from: pos, to: pos + 1 };
  if (pos > 0 && text[pos - 1] === "*") return { from: pos - 1, to: pos };
  let left = pos;
  while (left > 0 && isInlineSpace(text[left - 1])) left--;
  if (left > 0 && text[left - 1] === "*") return { from: left - 1, to: left };
  let right = pos;
  while (right < text.length && isInlineSpace(text[right])) right++;
  if (text[right] === "*") return { from: right, to: right + 1 };
  return null;
}

function isInlineSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t";
}

function isSelectStar(statement: string, star: number): boolean {
  const before = statement.slice(0, star);
  const after = statement.slice(star + 1);
  return /\bSELECT\b/i.test(before) && /\bFROM\b/i.test(after);
}

function qualifierBeforeStar(statement: string, star: number): string | null {
  const match = statement.slice(0, star).match(/([\w.]+)\.$/);
  return match?.[1] ?? null;
}

interface TableRef {
  tableName: string;
  alias?: string;
}

function tableRefs(statement: string): TableRef[] {
  const resolved = resolveJinjaRefs(statement);
  const refs: TableRef[] = [];
  for (const match of resolved.matchAll(/\bFROM\s+/gi)) {
    const rest = resolved.slice(match.index! + match[0].length);
    const end = SQL_BOUNDARY.exec(rest);
    const fromBlock = end ? rest.slice(0, end.index) : rest;
    for (const part of fromBlock.split(",")) {
      const ref = tableRefFromSegment(part);
      if (ref) refs.push(ref);
    }
  }
  for (const match of resolved.matchAll(/\bJOIN\s+([^,]+)/gi)) {
    const ref = tableRefFromSegment(match[1]);
    if (ref) refs.push(ref);
  }
  return refs;
}

// Rewrites dbt/SQLMesh `{{ ref('model') }}` / `{{ source('src', 'tbl') }}`
// references to their bare relation name so a `SELECT *` over them can be
// expanded against the warehouse schema, exactly like a plain SQL table
// reference. `ref('pkg', 'model')` and `source('src', 'tbl')` take the last
// quoted argument as the relation name. Done before FROM/JOIN parsing so the
// commas inside jinja arg lists don't split a single reference into pieces.
function resolveJinjaRefs(statement: string): string {
  return statement.replace(
    /\{\{-?\s*(?:ref|source)\s*\(([^)]*)\)\s*-?\}\}/gis,
    (_match, argsText: string) => {
      const args = [...argsText.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
      return args[args.length - 1] ?? "";
    },
  );
}

function tableRefFromSegment(segment: string): TableRef | null {
  const trimmed = segment.trim();
  const end = SQL_BOUNDARY.exec(trimmed);
  const block = end ? trimmed.slice(0, end.index).trim() : trimmed;
  const match = block.match(/^([\w.]+)(?:\s+(?:AS\s+)?(\w+))?/i);
  if (!match) return null;
  const alias = match[2];
  return {
    tableName: match[1],
    alias: alias && !SQL_KEYWORDS.has(alias.toLowerCase()) ? alias : undefined,
  };
}

// Resolves the FROM source for the SELECT that owns the star. For an
// unqualified `SELECT *` this is the FROM clause immediately following the
// star, scoping to the current SELECT so a star inside one CTE doesn't get
// confused by FROM clauses in sibling CTEs. Refuses when that FROM scope has
// more than one table (comma list or JOIN), where `*` is ambiguous.
function fromTableAfterStar(statement: string, star: number): TableRef | null {
  const afterStar = statement.slice(star);
  const from = /\bFROM\s+/i.exec(afterStar);
  if (!from) return null;
  const rest = afterStar.slice(from.index + from[0].length);
  const scope = fromScope(rest);
  if (scope === null) return null;
  const end = SQL_BOUNDARY.exec(scope);
  const block = end ? scope.slice(0, end.index) : scope;
  if (/\bJOIN\b/i.test(block)) return null;
  return tableRefFromSegment(resolveJinjaRefs(block));
}

// Cuts the FROM clause down to the current SELECT's scope. A depth-0 `)`
// closes the enclosing subquery/CTE, ending the clause; a depth-0 `,` is a
// multi-table FROM list, which is ambiguous for `*` (returns null). Parens
// inside jinja `{{ ref(...) }}` are balanced, so they don't end the scope.
function fromScope(rest: string): string | null {
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) return rest.slice(0, i);
      depth--;
    } else if (ch === "," && depth === 0) {
      return null;
    }
  }
  return rest;
}

function resolveTargetTable(
  qualifier: string | null,
  statement: string,
  star: number,
  schema: SqlSchemaDict,
): TableRef | null {
  if (qualifier) {
    const byAlias = tableRefs(statement).find((r) => r.alias === qualifier);
    if (byAlias) return resolveSchemaTable(byAlias.tableName, schema);
    return resolveSchemaTable(qualifier, schema);
  }
  const ref = fromTableAfterStar(statement, star);
  if (!ref) return null;
  return resolveSchemaTable(ref.tableName, schema);
}

function resolveSchemaTable(tableName: string, schema: SqlSchemaDict): TableRef | null {
  if (schema[tableName]) return { tableName };
  const bare = tableName.split(".").pop();
  if (!bare) return null;
  if (schema[bare]) return { tableName: bare };
  const matches = Object.keys(schema).filter((name) => name.endsWith(`.${bare}`));
  return matches.length === 1 ? { tableName: matches[0] } : null;
}

// A dbt/SQLMesh model or source whose columns come from the project graph
// rather than the warehouse schema. `kind === "source"` nodes are keyed in the
// dict by their bare table name (the last segment of `source.table`), matching
// how `{{ source('src', 'tbl') }}` resolves to `tbl`. `sql` is the model's live
// (possibly un-saved, un-run) `.sql` text; its `SELECT` output columns are
// parsed first so expansion reflects edits before any compile/run.
interface StarSchemaModel {
  name: string;
  kind?: string;
  columns?: { name: string; type?: string }[];
  sql?: string;
}

// Strips `--` line comments and `/* */` block comments, then jinja `{{ }}` /
// `{% %}` blocks, so the column-list parser sees plain SQL. Jinja is balanced,
// so blanking it never unbalances the parens the scanner tracks; a templated
// column (e.g. `{{ dbt_utils.star() }}`) collapses to nothing and forces a
// confident-parse failure (→ warehouse fall-through) rather than a wrong guess.
function stripSqlNoise(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\{\{[\s\S]*?\}\}/g, " ")
    .replace(/\{%[\s\S]*?%\}/g, " ");
}

function isInlineQuote(ch: string): boolean {
  return ch === "'" || ch === '"' || ch === "`";
}

// Advances past a quoted string opened at `open`, returning the index of the
// closing quote. Doubled quotes (`''`) are escapes, not terminators: standard
// SQL string/identifier quoting.
function skipQuoted(text: string, open: number): number {
  const quote = text[open];
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === quote) {
      if (text[i + 1] === quote) i++;
      else return i;
    }
  }
  return text.length;
}

function matchesKeywordAt(text: string, i: number, kw: string): boolean {
  if (text.slice(i, i + kw.length).toUpperCase() !== kw) return false;
  const before = text[i - 1];
  const after = text[i + kw.length];
  return !/\w/.test(before ?? "") && !/\w/.test(after ?? "");
}

// Finds `kw` at paren-depth 0 from `start`, skipping quoted strings so a keyword
// inside a literal/identifier or a nested subquery doesn't match. Returns -1
// when no top-level occurrence exists.
function topLevelKeyword(text: string, start: number, kw: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (isInlineQuote(ch)) {
      i = skipQuoted(text, i);
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && matchesKeywordAt(text, i, kw)) return i;
  }
  return -1;
}

// Splits a column-list region on paren-depth-0 commas, leaving commas inside
// function calls / subqueries intact.
function splitTopLevelCommas(region: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < region.length; i++) {
    const ch = region[i];
    if (isInlineQuote(ch)) {
      i = skipQuoted(region, i);
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(region.slice(last, i));
      last = i + 1;
    }
  }
  parts.push(region.slice(last));
  return parts;
}

function unquoteIdent(ident: string): string {
  return /^(["'`]).*\1$/.test(ident) ? ident.slice(1, -1) : ident;
}

const BARE_COLUMN = /^(?:"[^"]+"|`[^`]+`|\w+)(?:\.(?:"[^"]+"|`[^`]+`|\w+))*$/;
const TRAILING_ALIAS = /\s+AS\s+(?:"([^"]+)"|`([^`]+)`|(\w+))\s*$/i;

// Derives the output column name for one select-list item. Returns null when the
// name can't be determined confidently (a `*` / `t.*`, or an un-aliased
// expression) so the whole parse bails to the warehouse schema.
function outputColumnName(segment: string): string | null {
  const s = segment.trim();
  if (!s) return null;
  if (/(?:^|\.)\*$/.test(s)) return null;
  const alias = s.match(TRAILING_ALIAS);
  if (alias) return alias[1] ?? alias[2] ?? alias[3] ?? null;
  if (BARE_COLUMN.test(s)) return unquoteIdent(s.split(".").pop()!);
  return null;
}

// Parses the output column names of a single flat `SELECT ... FROM ...` model.
// Returns null (deferring to the warehouse schema) for anything not
// confidently flat: CTEs (`WITH`), set operations, `SELECT *`, joins, or any
// select-list item whose output name can't be derived. This is the live source
// of truth for expand-all, reflecting un-saved/un-run edits the warehouse and
// `schema.yml` scan can't see.
function selectOutputColumns(sql: string | undefined): string[] | null {
  if (!sql) return null;
  const clean = stripSqlNoise(sql);
  if (/\bWITH\b/i.test(clean)) return null;
  if (/\b(?:UNION|INTERSECT|EXCEPT)\b/i.test(clean)) return null;
  const select = /\bSELECT\b/i.exec(clean);
  if (!select) return null;
  let listStart = select.index + select[0].length;
  const distinct = /^\s+DISTINCT\b/i.exec(clean.slice(listStart));
  if (distinct) listStart += distinct[0].length;
  const fromIdx = topLevelKeyword(clean, listStart, "FROM");
  if (fromIdx < 0) return null;
  if (/\bJOIN\b/i.test(clean.slice(fromIdx))) return null;
  const region = clean.slice(listStart, fromIdx);
  const names: string[] = [];
  for (const part of splitTopLevelCommas(region)) {
    const name = outputColumnName(part);
    if (!name) return null;
    names.push(name);
  }
  return names.length ? names : null;
}

// Folds dbt/SQLMesh model + source columns into the warehouse schema dict so a
// `SELECT *` over a `{{ ref(...) }}` / `{{ source(...) }}` relation can expand
// even when that relation isn't (yet) in the warehouse. Returns the base dict
// unchanged when there are no models to fold in.
//
// Column source precedence, per relation:
//   1. Live `SELECT` output columns parsed from the model's `.sql`, reflects
//      un-saved/un-run edits immediately.
//   2. Warehouse columns (`base`) when the relation is materialized, these are
//      real and win over the project scan (fixes the schema.yml-overwrite bug).
//   3. Scanned model/source metadata columns, last-resort gap fill.
function buildStarExpansionSchema(
  base: SqlSchemaDict,
  dbtNodes: StarSchemaModel[],
  sqlmeshModels: StarSchemaModel[],
): SqlSchemaDict {
  if (dbtNodes.length === 0 && sqlmeshModels.length === 0) return base;
  const dict: SqlSchemaDict = { ...base };
  const fold = (model: StarSchemaModel, key: string) => {
    const live = selectOutputColumns(model.sql);
    if (live) {
      dict[key] = live.map((name) => ({ name }));
      return;
    }
    if (dict[key]) return;
    if (model.columns?.length) {
      dict[key] = model.columns.map((c) => ({ name: c.name, type: c.type }));
    }
  };
  for (const node of dbtNodes) {
    const key = node.kind === "source" ? (node.name.split(".").pop() ?? node.name) : node.name;
    fold(node, key);
  }
  for (const model of sqlmeshModels) {
    fold(model, model.name);
  }
  return dict;
}

export {
  expandStarAtCursor,
  buildStarExpansionSchema,
  selectOutputColumns,
};

export type {
  StarExpansion,
  StarSchemaModel,
};
