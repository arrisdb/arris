import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { sql } from "@codemirror/lang-sql";

import type { QueryResult } from "@shared";

import { CELL_REF_MARK_CLASS } from "./constants";
import { queryEditorExtensions, runResultSummary } from "./utils";

function mount(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: queryEditorExtensions({ support: sql(), onChange: () => {}, onRun: () => {} }),
    }),
  });
}

function result(rows: number, cols: number): QueryResult {
  return {
    columns: Array.from({ length: cols }, (_, i) => ({ name: `c${i}`, type_hint: "text" })),
    rows: Array.from({ length: rows }, () => []),
    elapsed: 0,
    statementType: "query",
  } as QueryResult;
}

describe("runResultSummary", () => {
  it("shows plain counts when the page holds the whole result", () => {
    expect(runResultSummary(result(3, 2))).toBe("3 rows · 2 columns");
    expect(runResultSummary(result(3, 2), 3, true)).toBe("3 rows · 2 columns");
  });

  it("uses singular forms for one row and one column", () => {
    expect(runResultSummary(result(1, 1))).toBe("1 row · 1 column");
  });

  it("reports the full total when it is larger than the page", () => {
    expect(runResultSummary(result(500, 4), 12345, true)).toBe(
      "12345 rows · 4 columns",
    );
  });

  it("appends a plus when the ingestion budget truncated the run", () => {
    expect(runResultSummary(result(500, 4), 9000, false)).toBe(
      "9000+ rows · 4 columns",
    );
  });

  it("never reports a total smaller than the visible page", () => {
    expect(runResultSummary(result(100, 1), 0, false)).toBe(
      "100+ rows · 1 column",
    );
  });
});

describe("cell reference highlighting", () => {
  it("marks a backtick-quoted reference", () => {
    const view = mount("SELECT * FROM `Query 1`");
    const marks = view.dom.querySelectorAll(`.${CELL_REF_MARK_CLASS}`);
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("`Query 1`");
    view.destroy();
  });

  it("leaves an unbalanced quote unmarked", () => {
    const view = mount("SELECT * FROM `Query 1");
    expect(view.dom.querySelectorAll(`.${CELL_REF_MARK_CLASS}`)).toHaveLength(0);
    view.destroy();
  });

  it("draws its own caret layer so the cursor tracks programmatic edits", () => {
    const view = mount("SELECT 1");
    expect(view.dom.querySelector(".cm-cursorLayer")).not.toBeNull();
    view.destroy();
  });
});
