import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { sql, StandardSQL } from "@codemirror/lang-sql";
import { arrisHighlight } from "@shared/ui/utils/codeHighlight";
import { editorLanguageExtensions } from "../dialects/registry";
import {
  classifyLeaves,
  collectLeaves,
  sqlSemanticField,
  sqlSemanticHighlight,
  type Role,
} from "./sqlSemanticHighlight";

// The LEAF span that directly wraps the glyphs for `word` (its own colour is
// what the user actually sees; a parent wrapper's inherited colour does not
// win over a child element's own colour rule).
function leafStyle(view: EditorView, word: string): string | null {
  for (const el of Array.from(view.contentDOM.querySelectorAll<HTMLElement>("span"))) {
    const ownsText = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && n.textContent === word,
    );
    if (ownsText) return el.getAttribute("style") || `class:${el.className}`;
  }
  return null;
}

function roles(doc: string): { text: string; role: Role }[] {
  const state = EditorState.create({ doc, extensions: [sql({ dialect: StandardSQL })] });
  return classifyLeaves(state, collectLeaves(state)).map((s) => ({
    text: doc.slice(s.from, s.to),
    role: s.role,
  }));
}

function roleOf(doc: string, text: string): Role | undefined {
  return roles(doc).find((r) => r.text === text)?.role;
}

describe("sql semantic highlight", () => {
  it("colors a function call (identifier followed by parens)", () => {
    expect(roleOf("SELECT COALESCE(a, 0) FROM t", "COALESCE")).toBe("function");
  });

  it("colors aggregate keywords (COUNT/SUM) as functions", () => {
    const doc = "SELECT COUNT(*), SUM(amount) FROM orders";
    expect(roleOf(doc, "COUNT")).toBe("function");
    expect(roleOf(doc, "SUM")).toBe("function");
  });

  it("colors the table after FROM and its alias distinctly", () => {
    const doc = "SELECT x FROM customers c";
    expect(roleOf(doc, "customers")).toBe("table");
    expect(roleOf(doc, "c")).toBe("alias");
  });

  it("colors JOIN tables and aliases", () => {
    const doc = "SELECT 1 FROM a x JOIN customer_orders co ON 1=1";
    expect(roleOf(doc, "customer_orders")).toBe("table");
    expect(roleOf(doc, "co")).toBe("alias");
  });

  it("colors a CTE name (WITH … AS () ) as a table", () => {
    const doc = "WITH customers AS ( SELECT 1 ) SELECT * FROM customers";
    expect(roles(doc).filter((r) => r.text === "customers")[0].role).toBe("table");
  });

  it("splits dotted member access into qualifier (alias) and column", () => {
    const doc = "SELECT c.email FROM customers c";
    const r = roles(doc);
    // first occurrence of `c` is the qualifier in `c.email`
    expect(r.find((x) => x.text === "c")?.role).toBe("alias");
    expect(roleOf(doc, "email")).toBe("column");
  });

  it("falls back to column for bare select-list identifiers", () => {
    expect(roleOf("SELECT customer_id FROM t", "customer_id")).toBe("column");
  });

  it("does not decorate keywords, numbers or operators", () => {
    const texts = roles("SELECT 1 + 2 FROM t").map((r) => r.text);
    expect(texts).not.toContain("SELECT");
    expect(texts).not.toContain("1");
    expect(texts).not.toContain("+");
  });

  it("colours a source-qualified FROM table identically to a bare one (every segment = table)", () => {
    const doc = "SELECT ord.amount FROM prod_elasticsearch.orders ord";
    expect(roleOf(doc, "prod_elasticsearch")).toBe("table");
    // the bare-table baseline this should match
    expect(roleOf("SELECT 1 FROM orders", "orders")).toBe("table");
    // `orders` qualifier segment in the dotted chain is still a table, not a column
    const r = roles(doc);
    expect(r.find((x) => x.text === "orders" && x.role === "table")).toBeTruthy();
  });

  it("colours the trailing alias of a qualified table as alias", () => {
    const doc = "SELECT 1 FROM prod_es.orders ord";
    expect(roleOf(doc, "prod_es")).toBe("table");
    expect(roleOf(doc, "ord")).toBe("alias");
  });

  it("colours a qualified JOIN table chain as table, with its alias", () => {
    const doc = "SELECT 1 FROM a x JOIN prod_pg.public.customers co ON 1=1";
    expect(roleOf(doc, "prod_pg")).toBe("table");
    expect(roleOf(doc, "public")).toBe("table");
    expect(roleOf(doc, "customers")).toBe("table");
    expect(roleOf(doc, "co")).toBe("alias");
  });

  it("still splits dotted member access OUTSIDE a table context into alias/column", () => {
    // ON-clause qualifier.column must stay alias.column, not table.table
    const doc = "SELECT 1 FROM orders o JOIN c ON o.id = c.id";
    const r = roles(doc);
    expect(r.find((x) => x.text === "o" && x.role === "alias")).toBeTruthy();
    expect(roleOf(doc, "id")).toBe("column");
  });

  // the INSERT target's colour must not flip when a column-list paren
  // follows it. `INSERT INTO dummy(...)` is a table + a column list, never a
  // function call; it must match the bare `INSERT INTO dummy` colour.
  it("colours an INSERT target with a column list as a table (not a function)", () => {
    expect(roleOf("INSERT INTO dummy(name) VALUES ('x')", "dummy")).toBe("table");
    expect(roleOf("INSERT INTO dummy (name) VALUES ('x')", "dummy")).toBe("table");
    expect(roleOf("INSERT INTO dummy()", "dummy")).toBe("table");
    // baseline: no paren at all is already a table, so the two must agree.
    expect(roleOf("INSERT INTO dummy DEFAULT VALUES", "dummy")).toBe("table");
  });

  it("colours a CREATE TABLE target with a column list as a table", () => {
    expect(roleOf("CREATE TABLE dummy (id int)", "dummy")).toBe("table");
  });

  // identifiers inside an INSERT/CREATE column list are columns, the
  // same role a SELECT-list column gets, not aliases or tables. Previously the
  // `afterTableKeyword` state leaked through the parens so the first column read
  // as `alias` and the rest as `table`, giving the list two stray colours.
  it("colours every identifier in an INSERT column list as a column", () => {
    const doc =
      "INSERT INTO customers(customer_id, first_name, last_name, email) VALUES (13, 'a', 'b', 'c')";
    expect(roleOf(doc, "customers")).toBe("table");
    expect(roleOf(doc, "customer_id")).toBe("column");
    expect(roleOf(doc, "first_name")).toBe("column");
    expect(roleOf(doc, "last_name")).toBe("column");
    expect(roleOf(doc, "email")).toBe("column");
  });

  it("colours the column list the same whether the paren hugs the table or not", () => {
    expect(roleOf("INSERT INTO t (a, b) VALUES (1, 2)", "a")).toBe("column");
    expect(roleOf("INSERT INTO t(a, b) VALUES (1, 2)", "a")).toBe("column");
  });

  it("colours CREATE TABLE column names as columns", () => {
    // Plain identifiers: lang-sql lexes words like `name` as keywords, so they
    // never reach the identifier classifier.
    const doc = "CREATE TABLE dummy (customer_id int, total_amount numeric)";
    expect(roleOf(doc, "customer_id")).toBe("column");
    expect(roleOf(doc, "total_amount")).toBe("column");
  });

  it("resumes normal classification after the column list closes", () => {
    // The table of a *second* statement must still colour as a table, proof the
    // column-list state is cleared at the closing paren, not left dangling.
    const doc = "INSERT INTO a(x) VALUES (1); SELECT y FROM b";
    expect(roleOf(doc, "x")).toBe("column");
    expect(roleOf(doc, "b")).toBe("table");
    expect(roleOf(doc, "y")).toBe("column");
  });

  // Regression guard: a table-valued function after FROM/JOIN is still a function,
  // because there the paren is a call, not a column list.
  it("still colours a table-valued function after FROM as a function", () => {
    expect(roleOf("SELECT * FROM generate_series(1, 10)", "generate_series")).toBe("function");
  });
});

// End-to-end through a real EditorView with the same stack the editor mounts:
// lang-sql + arrisHighlight + the semantic field. Proves the field actually
// produces decorations in a fully configured view (not just the pure helper) and
// that the role colour lands as an inline style on the rendered token span,
// winning over `syntaxHighlighting`.
describe("sql semantic highlight (mounted view)", () => {
  function mount(doc: string): EditorView {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const state = EditorState.create({
      doc,
      extensions: [
        sql({ dialect: StandardSQL }),
        syntaxHighlighting(arrisHighlight, { fallback: true }),
        sqlSemanticHighlight(),
      ],
    });
    return new EditorView({ state, parent: host });
  }

  it("produces role decorations in a configured view", () => {
    const view = mount("SELECT c.email FROM customers c");
    const decos = view.state.field(sqlSemanticField);
    const ranges: string[] = [];
    const iter = decos.iter();
    while (iter.value) {
      ranges.push(view.state.doc.sliceString(iter.from, iter.to));
      iter.next();
    }
    expect(ranges).toContain("customers"); // table
    expect(ranges).toContain("email"); // column
    expect(ranges).toContain("c"); // alias
    view.destroy();
  });

  // Precedence regression: the role colour must land on the LEAF span (the one
  // that directly wraps the glyphs), winning over `syntaxHighlighting`'s class.
  // syntaxHighlighting nests its own class span around each token; if the
  // semantic field does not sit at higher precedence its mark becomes the outer
  // wrapper and the inner class colour wins, so every identifier renders flat.
  function mountViaRegistry(doc: string): EditorView {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const state = EditorState.create({
      doc,
      extensions: [
        ...editorLanguageExtensions({ languageId: "sql" }),
        syntaxHighlighting(arrisHighlight, { fallback: true }),
      ],
    });
    return new EditorView({ state, parent: host });
  }

  it("paints role colours on the leaf token spans (wins over syntaxHighlighting)", () => {
    const view = mountViaRegistry("SELECT c.email FROM customers c");
    expect(leafStyle(view, "customers")).toContain("--m-syn-type"); // table
    expect(leafStyle(view, "email")).toContain("--m-syn-property"); // column
    view.destroy();
  });

  it("colours functions on the leaf span through the real registry path", () => {
    const view = mountViaRegistry("SELECT COUNT(*), COALESCE(x, 0) FROM t");
    expect(leafStyle(view, "COUNT")).toContain("--m-syn-function");
    expect(leafStyle(view, "COALESCE")).toContain("--m-syn-function");
    view.destroy();
  });
});

// a half-typed word (`FRO` on the way to `FROM`) must stay plain white
// while the caret is on it, then take its role colour once the caret leaves,
// not flash the alias/column colour (nor the flat `t.name` base hue) mid-keystroke.
describe("sql semantic highlight (token under the caret)", () => {
  const DOC = "SELECT x FROM customers\nFRO";
  const FRO_END = DOC.length; // caret right after the last char of FRO

  function mountWithCaret(doc: string, caret: number): EditorView {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const state = EditorState.create({
      doc,
      selection: { anchor: caret },
      extensions: [
        ...editorLanguageExtensions({ languageId: "sql" }),
        syntaxHighlighting(arrisHighlight, { fallback: true }),
      ],
    });
    return new EditorView({ state, parent: host });
  }

  it("renders the token under the caret in the default fg, not its role colour", () => {
    const view = mountWithCaret(DOC, FRO_END);
    const style = leafStyle(view, "FRO");
    expect(style).toContain("--m-fg");
    expect(style).not.toContain("--m-syn-variable");
    view.destroy();
  });

  it("applies the role colour once the caret leaves the token", () => {
    const view = mountWithCaret(DOC, 0); // caret at doc start, far from FRO
    expect(leafStyle(view, "FRO")).toContain("--m-syn-variable"); // alias role
    view.destroy();
  });

  // Only *incomplete keywords* defer; a finished word keeps its colour even with
  // the caret on it. `SUM` is a known function, not a half-typed keyword.
  it("keeps a finished function coloured when the caret is inside it", () => {
    const doc = "SELECT SUM(acctbal) FROM t";
    const caret = doc.indexOf("SUM") + 2; // caret inside SUM
    const view = mountWithCaret(doc, caret);
    const style = leafStyle(view, "SUM");
    expect(style).toContain("--m-syn-function");
    expect(style).not.toContain("--m-fg");
    view.destroy();
  });

  it("keeps a real column coloured when the caret is on it (not a keyword near-miss)", () => {
    const doc = "SELECT nationkey FROM t";
    const caret = doc.indexOf("nationkey") + "nationkey".length; // caret at end of column
    const view = mountWithCaret(doc, caret);
    const style = leafStyle(view, "nationkey");
    expect(style).toContain("--m-syn-property"); // column role, not blanked
    expect(style).not.toContain("--m-fg");
    view.destroy();
  });
});
