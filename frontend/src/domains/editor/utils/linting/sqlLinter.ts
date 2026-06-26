import { ensureSyntaxTree } from "@codemirror/language";
import type { Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "INSERT", "INTO", "UPDATE", "DELETE",
  "CREATE", "ALTER", "DROP", "TABLE", "INDEX", "VIEW", "SET",
  "VALUES", "JOIN", "INNER", "LEFT", "RIGHT", "OUTER", "CROSS",
  "ON", "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE",
  "IS", "NULL", "AS", "ORDER", "BY", "GROUP", "HAVING", "LIMIT",
  "OFFSET", "UNION", "ALL", "DISTINCT", "CASE", "WHEN", "THEN",
  "ELSE", "END", "BEGIN", "COMMIT", "ROLLBACK", "GRANT", "REVOKE",
  "WITH", "RECURSIVE", "TRUNCATE", "EXPLAIN", "ANALYZE", "PRIMARY",
  "KEY", "FOREIGN", "REFERENCES", "CONSTRAINT", "DEFAULT", "CHECK",
  "UNIQUE", "ASC", "DESC", "FETCH", "NEXT", "ROWS", "ONLY",
  "RETURNING", "CONFLICT", "DO", "NOTHING", "REPLACE", "IGNORE",
  "TEMPORARY", "IF", "COLUMN", "ADD", "RENAME", "TO", "CASCADE",
  "RESTRICT", "NATURAL", "FULL", "USING", "EXCEPT", "INTERSECT",
  "HAVING", "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE",
  "CAST", "BOOLEAN", "INTEGER", "VARCHAR", "TEXT", "DATE", "TIME",
  "TIMESTAMP", "SERIAL", "BIGINT", "SMALLINT", "FLOAT", "DOUBLE",
  "DECIMAL", "NUMERIC", "CHAR", "BLOB", "REAL", "DATABASE",
  "SCHEMA", "USE", "SHOW", "DESCRIBE", "EXEC", "EXECUTE",
  "PROCEDURE", "FUNCTION", "TRIGGER", "SEQUENCE", "MATERIALIZED",
  "WINDOW", "PARTITION", "OVER", "RANK", "ROW_NUMBER", "DENSE_RANK",
  "LAG", "LEAD", "FIRST_VALUE", "LAST_VALUE", "NTH_VALUE",
  "NTILE", "PERCENT_RANK", "CUME_DIST", "UNBOUNDED", "PRECEDING",
  "FOLLOWING", "CURRENT", "ROW",
]);

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function isInObjectNamePosition(textBefore: string): boolean {
  const trimmed = textBefore.trimEnd();
  if (trimmed.length === 0) return false;

  const lastChar = trimmed[trimmed.length - 1];
  if (lastChar === "." || lastChar === "," || lastChar === "(") return true;

  const match = trimmed.match(/\b([A-Za-z_]\w*)\s*$/);
  if (match && SQL_KEYWORDS.has(match[1].toUpperCase())) return true;

  return false;
}

function findClosestKeyword(word: string): string | null {
  const upper = word.toUpperCase();
  if (SQL_KEYWORDS.has(upper)) return null;
  if (upper.length < 3) return null;
  let best: string | null = null;
  let bestDist = 3;
  for (const kw of SQL_KEYWORDS) {
    if (Math.abs(upper.length - kw.length) > 1) continue;
    if (upper[0] !== kw[0]) continue;
    const dist = editDistance(upper, kw);
    if (dist > 0 && dist < bestDist) {
      bestDist = dist;
      best = kw;
    }
  }
  return best;
}

// dbt/sqlmesh templating spans that are not plain SQL: Jinja expression
// (`{{ }}`), statement (`{% %}`) and comment (`{# #}`) blocks, sqlmesh `@macro`
// tokens, and the leading sqlmesh `MODEL(...)` / `AUDIT(...)` header block.
// Identifiers and parser errors inside these spans are not SQL, so the linter
// skips them.
function nonLintableRegions(text: string): [number, number][] {
  const regions: [number, number][] = [];

  for (const re of [/\{\{[\s\S]*?\}\}/g, /\{%[\s\S]*?%\}/g, /\{#[\s\S]*?#\}/g, /@\w+/g]) {
    for (const m of text.matchAll(re)) {
      regions.push([m.index!, m.index! + m[0].length]);
    }
  }

  const head = text.match(/^\s*(?:MODEL|AUDIT)\s*\(/i);
  if (head) {
    let depth = 0;
    for (let i = head[0].length - 1; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")" && --depth === 0) {
        regions.push([0, i + 1]);
        break;
      }
    }
  }

  return regions;
}

function isInNonLintableRegion(from: number, to: number, regions: readonly [number, number][]): boolean {
  return regions.some(([start, end]) => from < end && to > start);
}

// A half-typed keyword under the caret (`FRO` on the way to `FROM`) isn't a typo
// yet, so the "did you mean …?" suggestion mid-keystroke is noise.
// Suppress it while the caret sits inside or at the trailing edge of the token; it
// reappears once the caret moves past a word boundary. `> from` (not `>=`) so a
// suggestion the caret merely abuts from the left still shows.
function isBeingTyped(caret: number, from: number, to: number): boolean {
  return caret > from && caret <= to;
}

function sqlLintSource(view: EditorView): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const tree = ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  if (!tree) return diagnostics;
  const doc = view.state.doc;
  const caret = view.state.selection.main.head;
  const regions = nonLintableRegions(doc.toString());

  // Names the query itself introduces (table/CTE/subquery aliases, defined
  // object names). An identifier in an object-name position *defines* a name;
  // the same name reused elsewhere (e.g. `cut` in `... = cut.id` after being
  // declared `JOIN customers AS cut`) must not be flagged as a keyword typo.
  // Collected across the whole tree first so the order of use vs. definition
  // does not matter.
  const definedNames = new Set<string>();
  const candidates: { from: number; to: number; text: string }[] = [];

  tree.iterate({
    enter(node) {
      if (node.type.isError) {
        const from = node.from;
        const to = node.to;
        if (isInNonLintableRegion(from, to, regions)) return;
        const snippet = doc.sliceString(from, Math.min(doc.length, Math.max(to, from + 20))).trim();
        diagnostics.push({
          from,
          to: Math.max(to, from + 1),
          severity: "warning",
          message: snippet ? `Unexpected syntax near \`${snippet}\`` : "Syntax error",
          source: "sql-lint",
        });
        return;
      }

      if (node.name === "Identifier") {
        if (isInNonLintableRegion(node.from, node.to, regions)) return;
        const text = doc.sliceString(node.from, node.to);
        const textBefore = doc.sliceString(Math.max(0, node.from - 200), node.from);
        if (isInObjectNamePosition(textBefore)) {
          definedNames.add(text.toLowerCase());
          return;
        }
        candidates.push({ from: node.from, to: node.to, text });
      }
    },
  });

  for (const { from, to, text } of candidates) {
    if (definedNames.has(text.toLowerCase())) continue;
    if (isBeingTyped(caret, from, to)) continue;
    const suggestion = findClosestKeyword(text);
    if (suggestion) {
      diagnostics.push({
        from,
        to,
        severity: "warning",
        message: `Unknown \`${text}\` — did you mean \`${suggestion}\`?`,
        source: "sql-lint",
      });
    }
  }

  diagnostics.sort((a, b) => a.from - b.from);
  return diagnostics;
}

export {
  editDistance,
  findClosestKeyword,
  isInObjectNamePosition,
  sqlLintSource,
};
