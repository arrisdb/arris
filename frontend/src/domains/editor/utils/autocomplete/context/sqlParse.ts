// Pure text/parse helpers for the SQL completion provider: locating table
// references, resolving qualifiers against the schema, scoping the current
// statement, and detecting DDL / clause-keyword positions. No CodeMirror state and
// no option-building; those live in the suggesters.

import type { SqlSchemaDict } from "../sqlSchema";
import type { SqlClause } from "./clauseDetection";
import type { VirtualTable } from "./cteResolution";
import { SQL_KEYWORDS, STATEMENT_KEYWORDS } from "./sqlConstants";

const CLAUSE_BOUNDARY = /\b(?:WHERE|GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION|EXCEPT|INTERSECT|WINDOW|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|NATURAL|ON|SET)\b|;/i;

interface TableRef {
  tableName: string;
  alias?: string;
}

function extractReferencedTables(text: string): Set<string> {
  const tables = new Set<string>();
  for (const ref of tableRefs(text)) tables.add(ref.tableName);
  return tables;
}

function tableRefs(text: string): TableRef[] {
  const refs: TableRef[] = [];
  for (const fm of text.matchAll(/\bFROM\s+/gi)) {
    const rest = text.slice(fm.index! + fm[0].length);
    const end = CLAUSE_BOUNDARY.exec(rest);
    const fromBlock = end ? rest.slice(0, end.index) : rest;
    for (const part of fromBlock.split(",")) {
      const ref = tableRefFromSegment(part);
      if (ref) refs.push(ref);
    }
  }
  for (const m of text.matchAll(/\bJOIN\s+([\w.]+)(?:\s+(?:AS\s+)?(\w+))?/gi)) {
    const ref = tableRefFromSegment(m[2] ? `${m[1]} ${m[2]}` : m[1]);
    if (ref) refs.push(ref);
  }
  return refs;
}

function tableRefFromSegment(segment: string): TableRef | null {
  const trimmed = segment.trim();
  const end = CLAUSE_BOUNDARY.exec(trimmed);
  const block = end ? trimmed.slice(0, end.index).trim() : trimmed;
  const match = block.match(/^([\w.]+)(?:\s+(?:AS\s+)?(\w+))?/i);
  if (!match) return null;
  const alias = match[2];
  return {
    tableName: match[1],
    alias: alias && !isSqlKeyword(alias) ? alias : undefined,
  };
}

function isSqlKeyword(word: string): boolean {
  return SQL_KEYWORDS.some((kw) => kw.toLowerCase() === word.toLowerCase());
}

// The top-level SELECT projection (everything between SELECT and its own FROM),
// paren-depth aware so a subquery's inner FROM does not end the scan early. Returns
// null when there is no SELECT, and the rest of the text when there is no FROM
// (e.g. a still-being-typed `SELECT a, b AS x`).
function selectProjection(text: string): string | null {
  const sel = /\bSELECT\b/i.exec(text);
  if (!sel) return null;
  const start = sel.index + sel[0].length;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") { if (depth > 0) depth--; }
    else if (
      depth === 0 &&
      (c === "F" || c === "f") &&
      /^FROM\b/i.test(text.slice(i)) &&
      !/\w/.test(text[i - 1] ?? " ")
    ) {
      return text.slice(start, i);
    }
  }
  return text.slice(start);
}

// Column aliases declared in the current statement's SELECT projection
// (`expr AS alias`). They are valid references in HAVING / ORDER BY / WHERE but
// belong to no schema table, so the column suggester must offer them explicitly.
function selectClauseAliases(text: string): string[] {
  const projection = selectProjection(stripSqlComments(text));
  if (projection === null) return [];
  const aliases: string[] = [];
  for (const m of projection.matchAll(/\bAS\s+(\w+)/gi)) {
    if (!isSqlKeyword(m[1])) aliases.push(m[1]);
  }
  return aliases;
}

function qualifiedColumnContext(
  text: string,
  pos: number,
): { qualifier: string; from: number } | null {
  const before = text.slice(0, pos);
  const match = before.match(/(?:^|[^\w.])([\w.]+)\.([\w$]*)$/);
  if (!match) return null;
  return {
    qualifier: match[1],
    from: pos - match[2].length,
  };
}

// The most-qualified key (most dot segments) among candidates. `buildSqlSchema`
// registers a table under every progressive suffix (`t`, `public.t`, `db.public.t`)
// and `shadowedBareNames` keeps only the deepest one; the rest are shadowed and
// skipped in the column loop. Resolution must therefore land on that same deepest
// key, otherwise a bare `FROM t` resolves to a shadowed key and every column is
// filtered out (real Postgres connection showed functions but no columns).
function deepestKey(keys: string[]): string | null {
  let best: string | null = null;
  let bestDepth = -1;
  for (const k of keys) {
    const depth = k.split(".").length;
    if (depth > bestDepth) {
      best = k;
      bestDepth = depth;
    }
  }
  return best;
}

function resolveSchemaTable(tableName: string, schema: SqlSchemaDict): string | null {
  const direct = Object.keys(schema).filter(
    (name) => name === tableName || name.endsWith(`.${tableName}`),
  );
  if (direct.length > 0) return deepestKey(direct);
  const bare = tableName.split(".").pop();
  if (!bare) return null;
  const matches = Object.keys(schema).filter(
    (name) => name === bare || name.endsWith(`.${bare}`),
  );
  return deepestKey(matches);
}

function resolveQualifiedTable(
  qualifier: string,
  refs: TableRef[],
  schema: SqlSchemaDict,
): string | null {
  const byAlias = refs.find((ref) => ref.alias === qualifier);
  if (byAlias) return resolveSchemaTable(byAlias.tableName, schema);
  return resolveSchemaTable(qualifier, schema);
}

function shadowedBareNames(schema: SqlSchemaDict): Set<string> {
  const names = Object.keys(schema);
  const shadowed = new Set<string>();
  for (const name of names) {
    for (const other of names) {
      if (other !== name && other.endsWith(`.${name}`)) {
        shadowed.add(name);
        break;
      }
    }
  }
  return shadowed;
}

function extractReferencedDbtRefs(text: string): Set<string> {
  const refs = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*ref\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g)) {
    refs.add(m[1]);
  }
  return refs;
}

function extractReferencedDbtSources(text: string): Set<string> {
  const keys = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g)) {
    keys.add(`${m[1]}.${m[2]}`);
  }
  return keys;
}

function currentStatementBlock(text: string, pos: number): string {
  let start = 0;
  let depth = 0;
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] === ")") depth++;
    if (text[i] === "(") {
      if (depth > 0) depth--;
      else { start = i + 1; break; }
    }
    if (text[i] === ";") { start = i + 1; break; }
  }
  let end = text.length;
  depth = 0;
  for (let i = pos; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") {
      if (depth > 0) depth--;
      else { end = i; break; }
    }
    if (text[i] === ";") { end = i; break; }
  }
  return text.slice(start, end);
}

// The whole current statement, bounded only by `;` (parens ignored). Unlike
// `currentStatementBlock`, it does not stop at an enclosing `(`, so it still sees
// the statement's FROM/JOIN when the cursor sits inside a function call such as
// `SUM(ord|)`. Used to recover the in-scope table aliases there.
function statementScope(text: string, pos: number): string {
  const start = text.lastIndexOf(";", pos - 1) + 1;
  let end = text.indexOf(";", pos);
  if (end === -1) end = text.length;
  return text.slice(start, end);
}

function stripSqlComments(text: string): string {
  return text.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

// The current statement/paren scope from its start up to `pos`, with SQL comments
// blanked. contextAwareKeywords inspects this (not the whole statement) so a clause
// keyword appearing only after the cursor (or inside a comment, e.g. a
// commented-out `GROUP BY`, or the outer query's `ORDER BY` in a CTE) does not make
// the engine think that clause already exists and drop it from suggestions.
function clauseScopeBeforeCursor(text: string, pos: number): string {
  let start = 0;
  let depth = 0;
  for (let i = pos - 1; i >= 0; i--) {
    const c = text[i];
    if (c === ")") depth++;
    else if (c === "(") {
      if (depth > 0) depth--;
      else { start = i + 1; break; }
    } else if (c === ";") { start = i + 1; break; }
  }
  return stripSqlComments(text.slice(start, pos));
}

const CLAUSE_KEYWORD_RE =
  /\b(SELECT|FROM|JOIN|WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|ON|SET|VALUES|AND|OR)\b/gi;

// The clause keyword immediately governing `pos` within its statement, i.e. the
// last clause keyword typed before the cursor. Used to decide what (if anything)
// should auto-open when the field is still empty.
function precedingClauseKeyword(text: string, pos: number): string | null {
  const stmt = text.slice(0, pos).slice(text.slice(0, pos).lastIndexOf(";") + 1);
  let match: RegExpExecArray | null;
  let last: string | null = null;
  CLAUSE_KEYWORD_RE.lastIndex = 0;
  while ((match = CLAUSE_KEYWORD_RE.exec(stmt)) !== null) {
    last = match[0].toUpperCase().replace(/\s+/g, " ");
  }
  return last;
}

// Whether the completion menu should auto-open at a clause boundary even though no
// word has been typed yet (empty field, non-explicit trigger). Without this the
// user has to type a character or hit the shortcut for GROUP BY/ORDER BY to "kick
// in" or for their columns to appear. Kept narrow on purpose: the noisy
// SELECT projection list and the FROM table list stay suppressed until typing.
function shouldCompleteEmptyField(text: string, pos: number, clause: SqlClause): boolean {
  const stmt = text.slice(0, pos).slice(text.slice(0, pos).lastIndexOf(";") + 1);
  if (stmt.trim().length === 0) return false;
  const lastKw = precedingClauseKeyword(text, pos);
  // After GROUP BY / ORDER BY: auto-suggest the columns to group/order on.
  if (lastKw === "GROUP BY" || lastKw === "ORDER BY") return true;
  // At a clause boundary (after a completed FROM/JOIN table reference): auto-suggest
  // the next clause keywords (WHERE, GROUP BY, ORDER BY, LIMIT, ...).
  if (clause === "keyword") return true;
  // Inside an INSERT column list (`INSERT INTO t(` or after a comma): auto-suggest
  // the target table's columns without forcing a keystroke or the explicit shortcut.
  if (clause === "insert-columns") return true;
  return false;
}

function extractInsertTarget(text: string, pos: number): string | null {
  // The cursor sits inside the open column list of the *nearest* INSERT before
  // it, so take the LAST match. `match()` returns the first, which resolves the
  // wrong table in a multi-statement script (every earlier INSERT wins).
  const before = text.slice(0, pos);
  const re = /\bINSERT\s+INTO\s+([\w.]+)\s*\(/gi;
  let target: string | null = null;
  for (const m of before.matchAll(re)) target = m[1];
  return target;
}

function resolveVirtualTable(
  qualifier: string,
  refs: TableRef[],
  virtualTables: VirtualTable[],
): VirtualTable | null {
  const byAlias = refs.find((ref) => ref.alias === qualifier);
  const lookupName = byAlias ? byAlias.tableName : qualifier;
  return virtualTables.find((vt) => vt.name === lookupName) ?? null;
}

// For a multi-word keyword (`NOT NULL`, `PRIMARY KEY`, `NOT ENFORCED`, ...), drop
// the leading words already typed immediately before the cursor so accepting the
// completion inserts only the remainder; otherwise `NOT NULL` applied over a typed
// `NOT ` yields `NOT NOT NULL`. The full phrase stays the visible label.
function remainingKeyword(keyword: string, beforeWord: string): string {
  const words = keyword.split(" ");
  for (let k = words.length - 1; k >= 1; k--) {
    const lead = words.slice(0, k).join("\\s+");
    if (new RegExp(`(?:^|\\s)${lead}\\s+$`, "i").test(beforeWord)) {
      return words.slice(k).join(" ");
    }
  }
  return keyword;
}

// Whether the cursor is in a DDL position the generic clause-detector reports as
// `keyword` but that wants DDL-specific suggestions: `"object"` right after
// CREATE/ALTER/DROP (before the object kind), `"column-def"` inside a CREATE TABLE
// column list (constraints like PRIMARY KEY / NOT ENFORCED). Returns null otherwise.
function ddlKeywordContext(text: string, pos: number): "object" | "column-def" | null {
  const stmt = text.slice(0, pos);
  const fromSemi = stmt.slice(stmt.lastIndexOf(";") + 1);
  if (!/\b(CREATE|ALTER|DROP)\b/i.test(fromSemi)) return null;

  // Walk back to the nearest unmatched `(`; if it closes a `CREATE ... TABLE`
  // header we are inside the column-definition list.
  let depth = 0;
  for (let i = fromSemi.length - 1; i >= 0; i--) {
    const c = fromSemi[i];
    if (c === ")") depth++;
    else if (c === "(") {
      if (depth > 0) { depth--; continue; }
      // A CREATE TABLE header (not a CTAS `... AS (SELECT ...)`) opening here means
      // the parens are the column-definition list.
      const header = fromSemi.slice(0, i);
      const isCreateTable = /\bCREATE\b[\s\S]*\bTABLE\b/i.test(header)
        && !/\b(AS|SELECT)\b/i.test(header.slice(header.search(/\bTABLE\b/i)));
      return isCreateTable ? "column-def" : null;
    }
  }

  // Not inside parens: right after CREATE/ALTER/DROP and the object kind is not
  // yet named.
  if (
    /\b(CREATE|ALTER|DROP)\s+(OR\s+REPLACE\s+)?(IF\s+(NOT\s+)?EXISTS\s+)?\w*$/i.test(fromSemi) &&
    !/\b(TABLE|VIEW|INDEX|SCHEMA|FUNCTION|PROCEDURE|DATABASE)\b/i.test(fromSemi)
  ) {
    return "object";
  }
  return null;
}

function contextAwareKeywords(block: string): string[] {
  const upper = block.toUpperCase();
  const hasSelect = /\bSELECT\b/.test(upper);
  const hasFrom = /\bFROM\b/.test(upper);
  const hasWhere = /\bWHERE\b/.test(upper);
  const hasGroupBy = /\bGROUP\s+BY\b/.test(upper);
  const hasOrderBy = /\bORDER\s+BY\b/.test(upper);
  const hasHaving = /\bHAVING\b/.test(upper);

  // Write-statement scaffolding: INTO/VALUES/SET/FROM never appear in
  // STATEMENT_KEYWORDS, so without these arms `INSERT <cursor>` would only ever
  // suggest the statement starters and the user has to hand-type `INTO`/`VALUES`.
  const hasInsert = /\bINSERT\b/.test(upper);
  const hasInto = /\bINTO\b/.test(upper);
  const hasValues = /\bVALUES\b/.test(upper);
  if (hasInsert && !hasSelect) {
    if (!hasInto) return ["INTO"];
    if (!hasValues) return ["VALUES", "SELECT"];
  }
  if (/\bUPDATE\b/.test(upper) && !/\bSET\b/.test(upper)) return ["SET"];
  if (/\bDELETE\b/.test(upper) && !hasFrom) return ["FROM"];

  if (!hasSelect && !hasFrom) return STATEMENT_KEYWORDS;

  if (hasFrom && hasGroupBy && hasHaving && !hasOrderBy) {
    return ["ORDER BY", "LIMIT"];
  }
  if (hasFrom && hasGroupBy && !hasHaving) {
    return ["HAVING", "ORDER BY", "LIMIT"];
  }
  if (hasFrom && hasOrderBy) {
    return ["LIMIT", "OFFSET"];
  }
  if (hasFrom && hasWhere) {
    return ["GROUP BY", "ORDER BY", "LIMIT", "HAVING", "UNION"];
  }
  if (hasFrom) {
    return ["WHERE", "JOIN", "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "GROUP BY", "ORDER BY", "LIMIT", "HAVING", "UNION"];
  }
  if (hasSelect) {
    return ["FROM", "WHERE", "UNION"];
  }

  return STATEMENT_KEYWORDS;
}

export {
  CLAUSE_BOUNDARY,
  CLAUSE_KEYWORD_RE,
  clauseScopeBeforeCursor,
  contextAwareKeywords,
  currentStatementBlock,
  ddlKeywordContext,
  deepestKey,
  extractInsertTarget,
  extractReferencedDbtRefs,
  extractReferencedDbtSources,
  extractReferencedTables,
  isSqlKeyword,
  precedingClauseKeyword,
  qualifiedColumnContext,
  remainingKeyword,
  resolveQualifiedTable,
  resolveSchemaTable,
  resolveVirtualTable,
  selectClauseAliases,
  shadowedBareNames,
  shouldCompleteEmptyField,
  statementScope,
  stripSqlComments,
  tableRefFromSegment,
  tableRefs,
};

export type {
  TableRef,
};
