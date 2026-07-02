// Semantic SQL highlighting. `@codemirror/lang-sql` is a flat lexer: it tags
// every table, CTE, alias and column as the single `Identifier` token, so the
// shared highlight style can only give them one colour. Editors like Zed read
// richer because tree-sitter knows each identifier's *role*. This extension
// recovers that: it walks lang-sql's parse tree and, from the surrounding SQL
// structure, infers a role per identifier, then overlays a colour decoration.
//
// Roles map onto existing `--m-syn-*` variables so the chosen colour scheme and
// the per-token overrides (Settings → Appearance) still drive every colour:
//   function → --m-syn-function   table/CTE → --m-syn-type
//   alias    → --m-syn-variable   column    → --m-syn-property
//
// This is a heuristic over a flat token stream, not a full SQL analyser; it
// covers the common shapes (FROM/JOIN tables + aliases, WITH CTEs, dotted
// member access, function calls) and falls back to "column" when unsure.

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { Prec, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { findClosestKeyword } from "../linting/sqlLinter";
import { SEMANTIC_CONTEXT_CHARS, SEMANTIC_PARSE_BUDGET_MS } from "./constants";

type Role = "function" | "table" | "alias" | "column";

const ROLE_VAR: Record<Role, string> = {
  function: "--m-syn-function",
  table: "--m-syn-type",
  alias: "--m-syn-variable",
  column: "--m-syn-property",
};

// Keywords that introduce a table/CTE reference as their next identifier.
const TABLE_KEYWORDS = new Set(["FROM", "JOIN", "INTO", "UPDATE", "TABLE"]);
// lang-sql tags built-in functions (COUNT, SUM, COALESCE, CAST, …) as `Keyword`,
// not `Identifier`, so we can't allow-list them all. Instead: any keyword
// directly followed by `(` is a function call, EXCEPT these structural keywords
// that also legitimately precede `(` (`x AS (…)` CTE, `x IN (…)`, `… OVER (…)`).
// Without the deny-list, `AS (` would mis-colour as a function and break CTE
// detection.
const NON_FUNCTION_KEYWORDS = new Set([
  "AS", "IN", "EXISTS", "VALUES", "USING", "ON", "ALL", "ANY", "SOME", "OVER",
  "AND", "OR", "NOT", "BETWEEN", "WHEN", "THEN", "ELSE", "CASE", "FROM", "WHERE",
  "SELECT", "BY", "GROUP", "ORDER", "HAVING", "UNION", "RETURNING", "INTO",
  "FILTER", "WITHIN", "DISTINCT", "LIKE", "JOIN", "WITH",
]);

interface Leaf {
  name: string;
  from: number;
  to: number;
  text: string;
}

interface RoleSpan {
  from: number;
  to: number;
  role: Role;
}

const markCache = new Map<Role, Decoration>();

function roleMark(role: Role): Decoration {
  let mark = markCache.get(role);
  if (!mark) {
    mark = Decoration.mark({ attributes: { style: `color: var(${ROLE_VAR[role]})` } });
    markCache.set(role, mark);
  }
  return mark;
}

// An incomplete keyword being typed under the caret (`FRO` on the way to `FROM`)
// should read as plain text, not flash the alias/column colour (nor
// the flat `t.name` base hue) before it resolves. Overlay the default foreground
// so it stays plain until finished; the role colour then applies. `var(--m-fg)`
// overrides the base highlight for the same reason role colours do: this field is
// `Prec.highest`, so its span is the innermost wrapper and its own colour wins.
const plainMark = Decoration.mark({ attributes: { style: "color: var(--m-fg)" } });

// Caret is inside the token's interior or at its trailing edge, i.e. the token
// is being typed/edited. `> from` (not `>=`) so merely placing the caret just
// *before* a finished token doesn't blank its colour.
function isBeingTyped(caret: number, from: number, to: number): boolean {
  return caret > from && caret <= to;
}

// Only blank the token under the caret when it looks like an *unfinished keyword*
// (a near-miss of a real SQL keyword, the same signal the linter flags), NOT any
// token the caret happens to sit in. A finished word like `SUM` or a real column
// keeps its colour even while the cursor is on it; only `FRO`/`SELEC`-style
// half-typed keywords defer.
function isIncompleteKeyword(text: string): boolean {
  return findClosestKeyword(text) !== null;
}

function isIdentifier(name: string): boolean {
  return name === "Identifier" || name === "QuotedIdentifier";
}

function nextNonSpaceChar(state: EditorState, pos: number): string {
  const text = state.doc.sliceString(pos, Math.min(pos + 64, state.doc.length));
  const m = /\S/.exec(text);
  return m ? m[0] : "";
}

function prevNonSpaceChar(state: EditorState, pos: number): string {
  const start = Math.max(0, pos - 64);
  const text = state.doc.sliceString(start, pos);
  const m = /\S(?=\s*$)/.exec(text);
  return m ? m[0] : "";
}

function collectLeaves(state: EditorState, from = 0, to = state.doc.length): Leaf[] {
  const tree = ensureSyntaxTree(state, to, SEMANTIC_PARSE_BUDGET_MS) ?? syntaxTree(state);
  const leaves: Leaf[] = [];
  // `iterate` visits every node overlapping [from, to] in preorder. Test for a
  // leaf via `n.node.firstChild` (does not move the iterator); descending into
  // composites is what surfaces the qualifier segments of `db.table`.
  tree.iterate({
    from,
    to,
    enter: (n) => {
      if (!n.node.firstChild) {
        const text = state.doc.sliceString(n.from, n.to);
        if (text.trim()) leaves.push({ name: n.name, from: n.from, to: n.to, text });
      }
    },
  });
  return leaves;
}

function classifyLeaves(state: EditorState, leaves: Leaf[]): RoleSpan[] {
  const spans: RoleSpan[] = [];
  let afterTableKeyword = false;
  let tableKeyword = "";
  let haveTableName = false;
  let expectAlias = false;
  // Depth inside an `INSERT INTO t(...)` / `CREATE TABLE t(...)` column list.
  // Every identifier in there is a column (the same role a SELECT-list column
  // gets) so we colour by this flag instead of the table/alias heuristics,
  // which otherwise leak through the parens and stripe the list.
  // Depth-counted so a nested paren (`DEFAULT nextval('s')`, `CHECK (x > 0)`)
  // doesn't close the list early.
  let columnListDepth = 0;

  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    const upper = leaf.text.toUpperCase();

    if (leaf.text === "(") {
      if (columnListDepth > 0) columnListDepth++;
      else if (
        afterTableKeyword && haveTableName &&
        (tableKeyword === "INTO" || tableKeyword === "TABLE")
      ) {
        columnListDepth = 1;
      }
      continue;
    }
    if (leaf.text === ")") {
      if (columnListDepth > 0 && --columnListDepth === 0) {
        afterTableKeyword = false;
        haveTableName = false;
        tableKeyword = "";
        expectAlias = false;
      }
      continue;
    }

    if (leaf.name === "Keyword") {
      if (!NON_FUNCTION_KEYWORDS.has(upper) && nextNonSpaceChar(state, leaf.to) === "(") {
        spans.push({ from: leaf.from, to: leaf.to, role: "function" });
        continue;
      }
      if (TABLE_KEYWORDS.has(upper)) {
        afterTableKeyword = true;
        tableKeyword = upper;
        haveTableName = false;
        expectAlias = false;
      } else if (upper === "AS") {
        expectAlias = true;
      } else {
        afterTableKeyword = false;
        haveTableName = false;
        expectAlias = false;
      }
      continue;
    }

    if (leaf.text === ",") {
      // New item in a SELECT/FROM list: the next identifier can start a fresh
      // table reference again, but we're no longer expecting an alias.
      haveTableName = false;
      expectAlias = false;
      continue;
    }

    if (!isIdentifier(leaf.name)) continue;

    const nextChar = nextNonSpaceChar(state, leaf.to);
    const prevChar = prevNonSpaceChar(state, leaf.from);
    const nextLeaf = leaves[i + 1];
    const isCteName =
      nextLeaf?.name === "Keyword" &&
      nextLeaf.text.toUpperCase() === "AS" &&
      nextNonSpaceChar(state, nextLeaf.to) === "(";

    // A paren right after the table name in `INSERT INTO t(...)` / `CREATE TABLE
    // t(...)` is a column list, not a call, so it must NOT flip the name to a
    // function (the table colour was inconsistent with the no-paren form).
    // A paren after a FROM/JOIN reference is still a table-valued function call.
    const inColumnListTable =
      afterTableKeyword && !haveTableName && (tableKeyword === "INTO" || tableKeyword === "TABLE");

    let role: Role;
    if (columnListDepth > 0) role = "column"; // identifier in a column list
    else if (nextChar === "(" && !inColumnListTable) role = "function";
    else if (afterTableKeyword && !haveTableName) {
      // In a FROM/JOIN/INTO/UPDATE/TABLE context the reference is a table, and a
      // *qualified* one (`container.schema.table`) is a dotted chain of identifiers.
      // Colour every segment as `table` so `prod_es.orders` matches a bare `orders`,
      // rather than splitting into `alias.column` (the dotted-member rules below).
      // The chain only ends when the next char is not a dot; a trailing identifier
      // after that is the table alias.
      role = "table";
      if (nextChar !== ".") haveTableName = true;
    } else if (nextChar === ".") role = "alias"; // qualifier in `alias.column`
    else if (prevChar === ".") role = "column"; // member in `alias.column`
    else if (isCteName) role = "table";
    else if (expectAlias) role = "alias";
    else if (afterTableKeyword && haveTableName) role = "alias";
    else role = "column";

    expectAlias = false;
    spans.push({ from: leaf.from, to: leaf.to, role });
  }

  return spans;
}

// Decorate only what the user can see. Was previously a StateField that forced
// a parse of the ENTIRE document (`ensureSyntaxTree(doc.length, 5000)`) and
// walked the whole tree on every keystroke AND every caret move, synchronously
// before paint, which made typing latency scale with document size. Now each
// rebuild covers `view.visibleRanges` plus a fixed context window, so the cost
// is O(viewport) regardless of how large the document grows.
function buildDecorations(view: EditorView): DecorationSet {
  const state = view.state;
  const caret = state.selection.main.head;
  const builder = new RangeSetBuilder<Decoration>();
  // Ranges are processed in order; `emittedTo` guards against re-emitting a
  // span when consecutive visible ranges share one context window.
  let emittedTo = -1;
  for (const range of view.visibleRanges) {
    const winFrom = Math.max(0, range.from - SEMANTIC_CONTEXT_CHARS);
    for (const span of classifyLeaves(state, collectLeaves(state, winFrom, range.to))) {
      if (span.to <= range.from || span.from <= emittedTo) continue;
      const typing =
        isBeingTyped(caret, span.from, span.to) &&
        isIncompleteKeyword(state.doc.sliceString(span.from, span.to));
      builder.add(span.from, span.to, typing ? plainMark : roleMark(span.role));
      emittedTo = span.to;
    }
  }
  return builder.finish();
}

const sqlSemanticPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      // Rebuild on edits, caret moves (the token-under-caret stays plain, so
      // the role colour must apply the moment the caret leaves it), viewport
      // scrolls, AND whenever the parse tree changes: lang-sql parses large
      // docs incrementally in the background and flushes non-doc-change
      // updates as the tree completes; without the tree-ref check those
      // identifiers would stay uncoloured until the next keystroke.
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

function sqlSemanticHighlight(): Extension {
  // `Prec.highest` so the role decoration nests *inside* `syntaxHighlighting`'s
  // class span, i.e. the semantic span becomes the leaf that directly wraps the
  // token text. A child element's own `color` beats the inherited colour from a
  // parent span, so without this the flat `name` colour (on the inner highlight
  // span) wins and every identifier renders the same hue.
  return Prec.highest(sqlSemanticPlugin);
}

export {
  buildDecorations,
  classifyLeaves,
  collectLeaves,
  sqlSemanticPlugin,
  sqlSemanticHighlight,
};
export type { Role, RoleSpan };
