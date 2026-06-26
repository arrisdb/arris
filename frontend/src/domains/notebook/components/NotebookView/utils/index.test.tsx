import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { cellViewPropsEqual, renderOutput, statusDotClass, statusLabelClass } from "./index";
import type { CellViewProps } from "../types";
import type { NotebookCell, NotebookOutput } from "../../../types";

// The HTML pandas emits for `pd.DataFrame({"a": [1, 2, 3]})`: a `<table>` with a
// `dataframe` class, a `<thead>` header row, and `<th>` index cells per body row.
const DATAFRAME_HTML =
  '<table border="1" class="dataframe">' +
  "<thead><tr><th></th><th>a</th></tr></thead>" +
  "<tbody>" +
  "<tr><th>0</th><td>1</td></tr>" +
  "<tr><th>1</th><td>2</td></tr>" +
  "<tr><th>2</th><td>3</td></tr>" +
  "</tbody></table>";

function htmlOutput(html: string): NotebookOutput {
  return {
    id: "out1",
    outputType: "executeResult",
    executionCount: 4,
    data: { "text/html": html },
    metadata: {},
  } as NotebookOutput;
}

describe("renderOutput — HTML mime", () => {
  it("wraps DataFrame HTML in the styled .mdbc-pyconsole-html container", () => {
    const { container } = render(<>{renderOutput(htmlOutput(DATAFRAME_HTML))}</>);

    const wrapper = container.querySelector(".mdbc-pyconsole-html");
    expect(wrapper).not.toBeNull();

    // The table survives injection and remains stylable by the scoped CSS.
    const table = wrapper!.querySelector("table.dataframe");
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("tbody tr").length).toBe(3);
    expect(table!.querySelectorAll("thead th").length).toBe(2);
  });
});

function codeCell(over: Partial<NotebookCell> = {}): NotebookCell {
  return {
    id: "c1",
    cellType: "code",
    source: "print(1)",
    outputs: [],
    executionCount: 1,
    metadata: {},
    rendered: false,
    pendingMsgId: null,
    ...over,
  };
}

function cellProps(cell: NotebookCell, over: Partial<CellViewProps> = {}): CellViewProps {
  const complete = vi.fn();
  const runCell = vi.fn();
  const onRunInsert = vi.fn();
  const onSelect = vi.fn();
  return {
    cell,
    notebookId: "nb1",
    connectionOptions: [],
    connectionKind: undefined,
    schemaNodes: undefined,
    editorFontSize: 13,
    complete,
    runCell,
    onRunInsert,
    onSelect,
    focusCellId: null,
    ...over,
  };
}

describe("status classes — no interpreter / dead kernel paint red", () => {
  it("tags the none and dead states so the .none/.dead CSS modifiers turn red", () => {
    expect(statusLabelClass("none")).toBe("mdbc-pyconsole-status none");
    expect(statusLabelClass("dead")).toBe("mdbc-pyconsole-status dead");
    expect(statusDotClass("none")).toBe("mdbc-pyconsole-dot none");
    expect(statusDotClass("dead")).toBe("mdbc-pyconsole-dot dead");
  });

  it("does not tag idle as an error state", () => {
    expect(statusLabelClass("idle")).toBe("mdbc-pyconsole-status idle");
    expect(statusLabelClass("idle")).not.toContain("none");
    expect(statusLabelClass("idle")).not.toContain("dead");
  });
});

describe("cellViewPropsEqual — keeps typing out of the render path", () => {
  it("treats a source-only change as equal (skips the re-render that froze the caret)", () => {
    // Mirrors the store's `setCellSource`: spread the same cell, replace only
    // `source`, every other field (incl. the `outputs`/`metadata` refs) is held.
    const cell = codeCell({ source: "import" });
    const shared = cellProps(cell);
    const next = { ...shared, cell: { ...cell, source: "impor" } }; // a backspace
    expect(cellViewPropsEqual(shared, next)).toBe(true);
  });

  it("re-renders when the run count changes (output prompt must update)", () => {
    const a = cellProps(codeCell({ executionCount: 1 }));
    const b = { ...a, cell: codeCell({ executionCount: 2 }) };
    expect(cellViewPropsEqual(a, b)).toBe(false);
  });

  it("re-renders when outputs, markdown toggle, or SQL binding change", () => {
    const base = cellProps(codeCell());
    expect(
      cellViewPropsEqual(base, { ...base, cell: codeCell({ outputs: [{} as NotebookOutput] }) }),
    ).toBe(false);
    expect(
      cellViewPropsEqual(base, { ...base, cell: codeCell({ rendered: true }) }),
    ).toBe(false);
    expect(
      cellViewPropsEqual(base, { ...base, cell: codeCell({ sqlVarName: "df2" }) }),
    ).toBe(false);
  });

  it("re-renders when a non-cell prop (schema, font size, callbacks) changes", () => {
    const base = cellProps(codeCell());
    expect(cellViewPropsEqual(base, { ...base, editorFontSize: 15 })).toBe(false);
    expect(cellViewPropsEqual(base, { ...base, schemaNodes: [] })).toBe(false);
    expect(cellViewPropsEqual(base, { ...base, runCell: vi.fn() })).toBe(false);
  });
});
