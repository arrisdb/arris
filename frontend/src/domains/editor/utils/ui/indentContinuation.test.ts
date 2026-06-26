import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { indentContinuationExtension } from "./indentContinuation";

function pressEnter(doc: string, anchor: number = doc.length) {
  const state = EditorState.create({
    doc,
    selection: { anchor },
    extensions: [indentContinuationExtension()],
  });
  const view = new EditorView({ state });
  try {
    insertNewlineAndIndent(view);
    return view.state.doc.toString();
  } finally {
    view.destroy();
  }
}

describe("indentContinuation", () => {
  it("carries the current line's indentation onto the new line", () => {
    expect(pressEnter("SELECT\n    order_date,")).toBe("SELECT\n    order_date,\n    ");
  });

  it("indents the body one level after a trailing clause keyword (SELECT)", () => {
    expect(pressEnter("SELECT")).toBe("SELECT\n  ");
  });

  it("indents columns under SELECT inside a CTE", () => {
    expect(pressEnter("WITH ord AS (\n  SELECT")).toBe("WITH ord AS (\n  SELECT\n    ");
  });

  it("indents the body after GROUP BY / ORDER BY (trailing BY)", () => {
    expect(pressEnter("  GROUP BY")).toBe("  GROUP BY\n    ");
  });

  it("indents a split mid-line to the current line's indentation", () => {
    const doc = "    a,b";
    const out = pressEnter(doc, doc.indexOf("b"));
    expect(out).toBe("    a,\n    b");
  });

  it("indents one level deeper after an open paren", () => {
    expect(pressEnter("WITH (")).toBe("WITH (\n  ");
  });

  it("adds continuation indent on top of existing indentation", () => {
    expect(pressEnter("    foo (")).toBe("    foo (\n      ");
  });

  it("indents after an open square bracket or brace", () => {
    expect(pressEnter("arr [")).toBe("arr [\n  ");
    expect(pressEnter("obj {")).toBe("obj {\n  ");
  });

  it("does not add continuation indent for a closed paren", () => {
    expect(pressEnter("count(*)")).toBe("count(*)\n");
  });

  it("dedents one level after a column line with no trailing comma (next is a clause)", () => {
    // `amount` is the last projection item; the new line should align with SELECT
    // (one level out) so the next keyword like FROM sits at the clause level.
    expect(pressEnter("  SELECT\n    amount")).toBe("  SELECT\n    amount\n  ");
  });

  it("keeps the indent after a column line that ends in a comma (another column)", () => {
    expect(pressEnter("  SELECT\n    customer_id,")).toBe("  SELECT\n    customer_id,\n    ");
  });

  it("dedents to the SELECT level after the last column inside a WITH CTE", () => {
    const doc = "WITH tmp AS (\n  SELECT\n    customer_id,\n    amount";
    expect(pressEnter(doc)).toBe(`${doc}\n  `);
  });

  it("does not runaway-dedent on a blank continuation line", () => {
    // Whitespace-only line before the cursor keeps the current indent (2), rather
    // than dedenting again. (insertNewlineAndIndent trims the vacated blank line.)
    const doc = "    amount\n  ";
    expect(pressEnter(doc)).toBe("    amount\n\n  ");
  });
});
