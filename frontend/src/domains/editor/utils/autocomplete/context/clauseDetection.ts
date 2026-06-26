import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

type SqlClause =
  | "from"
  | "column"
  | "keyword"
  | "insert-columns"
  | "values";

const TABLE_KW = new Set(["FROM", "JOIN", "TABLE", "UPDATE"]);
const COLUMN_KW = new Set([
  "SELECT", "WHERE", "AND", "OR", "ON", "SET", "HAVING",
  "BETWEEN", "WHEN", "THEN", "ELSE", "CASE",
]);
// Only these keywords mark a clause boundary. The SQL dialect has SQLMESH model
// DSL words (`name`, `start`, `owner`, …) and extra function words (`sum`, `over`,
// …) injected for highlighting, so a column literally named `name` tokenizes as a
// `Keyword`. Filtering the collected keyword list to this set keeps such a soft
// keyword from being mistaken for the last clause keyword; otherwise
// `SELECT name, <cursor>` mis-detects as `keyword` and drops column completions.
const CLAUSE_KEYWORDS = new Set<string>([
  ...TABLE_KW,
  ...COLUMN_KW,
  "INTO", "VALUES", "BY", "GROUP", "ORDER",
]);

type KeywordHit = { kw: string; from: number; to: number };

function collectKeywords(
  state: EditorState,
  from: number,
  to: number,
): KeywordHit[] {
  const tree = syntaxTree(state);
  const doc = state.doc.toString();
  const kws: KeywordHit[] = [];
  tree.iterate({
    from,
    to,
    enter(n) {
      if (n.type.name === "Keyword") {
        kws.push({ kw: doc.slice(n.from, n.to).toUpperCase(), from: n.from, to: n.to });
      }
    },
  });
  return kws;
}

// A FROM/JOIN/INTO keyword maps to the `from` clause, but once its table
// reference is already typed the cursor sits at the next token, where a new
// clause keyword (WHERE, GROUP BY, …) is expected, not another table. Detect a
// completed reference (non-empty text between the keyword and the cursor) and
// switch to `keyword` so those completions surface. A trailing comma means an
// old-style comma-separated table list is still open, so stay in `from`.
function resolveTableClause(
  clause: SqlClause,
  doc: string,
  keywordTo: number,
  pos: number,
): SqlClause {
  if (clause !== "from") return clause;
  const between = doc.slice(keywordTo, pos).trim();
  if (between.length > 0 && !between.endsWith(",")) return "keyword";
  return clause;
}

function findParenContext(
  state: EditorState,
  pos: number,
): { insideParens: boolean; parenFrom: number } {
  const tree = syntaxTree(state);
  let node = tree.resolveInner(pos, -1);
  while (node) {
    if (node.type.name === "Parens") {
      return { insideParens: true, parenFrom: node.from };
    }
    if (node.type.name === "Statement" || node.type.name === "Script") break;
    node = node.parent!;
  }
  return { insideParens: false, parenFrom: -1 };
}

function findStatementRange(
  state: EditorState,
  pos: number,
): { from: number; to: number } {
  const tree = syntaxTree(state);
  const doc = state.doc.toString();
  let stmtFrom = 0;
  let stmtTo = state.doc.length;
  let found = false;
  tree.iterate({
    enter(n) {
      if (n.type.name !== "Statement") return;
      if (n.from <= pos && n.to >= pos) {
        stmtFrom = n.from;
        stmtTo = n.to;
        found = true;
      } else if (!found && n.to <= pos && doc.charAt(n.to - 1) !== ";") {
        stmtFrom = n.from;
        stmtTo = n.to;
      }
    },
  });
  return { from: stmtFrom, to: stmtTo };
}

function isPastAllStatements(state: EditorState, pos: number): boolean {
  const tree = syntaxTree(state);
  const doc = state.doc.toString();
  let maxTo = 0;
  let lastStmtHasSemicolon = false;
  tree.iterate({
    enter(n) {
      if (n.type.name === "Statement" && n.to > maxTo) {
        maxTo = n.to;
        lastStmtHasSemicolon = doc.charAt(n.to - 1) === ";";
      }
    },
  });
  return maxTo > 0 && pos > maxTo && lastStmtHasSemicolon;
}

function mapKeywordToClause(lastKw: string, prevKw: string | null): SqlClause | null {
  if (TABLE_KW.has(lastKw)) return "from";
  if (lastKw === "INTO") return "from";
  if (COLUMN_KW.has(lastKw)) return "column";
  if (lastKw === "BY" && prevKw && (prevKw === "GROUP" || prevKw === "ORDER")) return "column";
  if (lastKw === "VALUES") return "values";
  return null;
}

function detectClauseFromTree(state: EditorState, pos: number): SqlClause | null {
  const tree = syntaxTree(state);
  if (tree.topNode.type.name !== "Script") return null;
  if (!tree.topNode.firstChild) return "keyword";

  if (isPastAllStatements(state, pos)) return "keyword";

  const doc = state.doc.toString();
  const { insideParens, parenFrom } = findParenContext(state, pos);
  const stmt = findStatementRange(state, pos);

  if (insideParens) {
    const kwInParens = collectKeywords(state, parenFrom + 1, pos);

    if (kwInParens.length > 0) {
      const last = kwInParens[kwInParens.length - 1];
      const prev = kwInParens.length > 1 ? kwInParens[kwInParens.length - 2].kw : null;
      const mapped = mapKeywordToClause(last.kw, prev);
      if (mapped) return resolveTableClause(mapped, doc, last.to, pos);
    }

    const kwBeforeParen = collectKeywords(state, stmt.from, parenFrom);
    const lastBefore = kwBeforeParen[kwBeforeParen.length - 1]?.kw;
    const prevBefore = kwBeforeParen.length > 1 ? kwBeforeParen[kwBeforeParen.length - 2].kw : null;

    if (lastBefore === "INTO" && prevBefore === "INSERT") return "insert-columns";
    if (lastBefore === "VALUES") return "values";

    if (kwInParens.length === 0) return "column";
  }

  const keywords = collectKeywords(state, stmt.from, pos).filter((k) =>
    CLAUSE_KEYWORDS.has(k.kw),
  );
  if (keywords.length === 0) return "keyword";

  const lastKw = keywords[keywords.length - 1];
  const prevKw = keywords.length > 1 ? keywords[keywords.length - 2].kw : null;

  const mapped = mapKeywordToClause(lastKw.kw, prevKw) ?? "keyword";
  return resolveTableClause(mapped, doc, lastKw.to, pos);
}

const TABLE_RE = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+$/i;
const INSERT_COL_RE = /\bINSERT\s+INTO\s+[\w.]+\s*\([^)]*$/i;
const VALUES_RE = /\bVALUES\s*\([^)]*$/i;
const COLUMN_RE =
  /\b(?:SELECT|WHERE|AND|OR|ON|SET|HAVING|ORDER\s+BY|GROUP\s+BY|WHEN|THEN|ELSE|CASE|BETWEEN)\s+$/i;

function detectClauseRegex(text: string, pos: number): SqlClause {
  const before = text.slice(0, pos);
  const trimmed = before.trimEnd();

  if (trimmed.length === 0 || /;\s*$/.test(before)) return "keyword";
  if (INSERT_COL_RE.test(before)) return "insert-columns";
  if (VALUES_RE.test(before)) return "values";
  if (TABLE_RE.test(before)) return "from";
  if (COLUMN_RE.test(before)) return "column";
  if (/,\s*$/.test(before)) return "column";

  return "keyword";
}

function detectClause(state: EditorState, pos: number): SqlClause {
  const doc = state.doc.toString();
  // Jinja templating ({{ ... }} / {% ... %}) confuses the Lezer SQL parser, so
  // the syntax-tree clause detector misfires, e.g. reporting `keyword` in the
  // middle of a dbt model's column list, which suppresses column completions.
  // Use the regex detector directly for templated documents.
  if (/\{\{|\{%/.test(doc)) return detectClauseRegex(doc, pos);
  return detectClauseFromTree(state, pos) ?? detectClauseRegex(doc, pos);
}

export { detectClause, detectClauseFromTree, detectClauseRegex };

export type { SqlClause };
