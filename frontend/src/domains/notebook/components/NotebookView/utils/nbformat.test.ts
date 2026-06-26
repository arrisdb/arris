import { describe, expect, it } from "vitest";

import { parseNotebook, serializeNotebook } from "./nbformat";
import type { NotebookCell } from "../../../types";

const SAMPLE = JSON.stringify({
  cells: [
    {
      cell_type: "markdown",
      metadata: { tags: ["intro"] },
      source: ["# Title\n", "\n", "Some text"],
    },
    {
      cell_type: "code",
      metadata: {},
      execution_count: 2,
      source: ["print('hi')\n", "x = 1"],
      outputs: [
        { output_type: "stream", name: "stdout", text: ["hi\n"] },
        {
          output_type: "execute_result",
          data: { "text/plain": ["1"] },
          metadata: {},
          execution_count: 2,
        },
        {
          output_type: "error",
          ename: "ValueError",
          evalue: "boom",
          traceback: ["Traceback", "ValueError: boom"],
        },
      ],
    },
    { cell_type: "raw", metadata: {}, source: "raw body" },
  ],
  metadata: { kernelspec: { name: "python3", display_name: "Python 3" } },
  nbformat: 4,
  nbformat_minor: 5,
});

/// Compare two parsed cell sets ignoring the locally-generated ids/transient
/// fields, so structural equality is what's asserted.
function stripIds(cells: NotebookCell[]) {
  return cells.map((c) => ({
    cellType: c.cellType,
    source: c.source,
    executionCount: c.executionCount,
    metadata: c.metadata,
    outputs: c.outputs.map(({ id: _id, ...rest }) => rest),
  }));
}

describe("nbformat", () => {
  it("parses cells, sources, outputs and metadata", () => {
    const nb = parseNotebook(SAMPLE);
    expect(nb.cells.map((c) => c.cellType)).toEqual(["markdown", "code", "raw"]);
    expect(nb.cells[0].source).toBe("# Title\n\nSome text");
    expect(nb.cells[0].metadata).toEqual({ tags: ["intro"] });
    expect(nb.cells[1].source).toBe("print('hi')\nx = 1");
    expect(nb.cells[1].executionCount).toBe(2);
    expect(nb.cells[1].outputs.map((o) => o.outputType)).toEqual([
      "stream",
      "executeResult",
      "error",
    ]);
    expect(nb.metadata).toEqual({
      kernelspec: { name: "python3", display_name: "Python 3" },
    });
    expect(nb.nbformatMinor).toBe(5);
    expect(nb.execCount).toBe(2);
  });

  it("markdown cells open rendered; code cells do not", () => {
    const nb = parseNotebook(SAMPLE);
    expect(nb.cells[0].rendered).toBe(true);
    expect(nb.cells[1].rendered).toBe(false);
  });

  it("round-trips parse → serialize → parse without losing structure", () => {
    const first = parseNotebook(SAMPLE);
    const text = serializeNotebook(first);
    const second = parseNotebook(text);
    expect(stripIds(second.cells)).toEqual(stripIds(first.cells));
    expect(second.metadata).toEqual(first.metadata);
    expect(second.nbformatMinor).toBe(first.nbformatMinor);
  });

  it("serializes to valid nbformat v4 with array-of-line sources", () => {
    const nb = parseNotebook(SAMPLE);
    const raw = JSON.parse(serializeNotebook(nb));
    expect(raw.nbformat).toBe(4);
    expect(raw.nbformat_minor).toBe(5);
    // Multi-line source becomes an array whose non-final lines keep their "\n".
    expect(raw.cells[1].source).toEqual(["print('hi')\n", "x = 1"]);
    // Code cells carry execution_count + outputs; markdown/raw do not.
    expect(raw.cells[1].execution_count).toBe(2);
    expect(raw.cells[0].execution_count).toBeUndefined();
    expect(raw.cells[0].outputs).toBeUndefined();
  });

  it("falls back to a single empty code cell for empty/invalid input", () => {
    for (const bad of ["", "   ", "not json", "{}", '{"cells":[]}']) {
      const nb = parseNotebook(bad);
      expect(nb.cells).toHaveLength(1);
      expect(nb.cells[0].cellType).toBe("code");
      expect(nb.cells[0].source).toBe("");
    }
  });

  it("treats unknown cell types as raw", () => {
    const nb = parseNotebook(JSON.stringify({ cells: [{ cell_type: "weird", source: "x" }] }));
    expect(nb.cells[0].cellType).toBe("raw");
  });

  it("parses an nbformat code cell tagged arris.kind=sql as a SQL cell", () => {
    const text = JSON.stringify({
      cells: [
        {
          cell_type: "code",
          metadata: { arris: { kind: "sql", connectionId: "conn-1", varName: "orders" }, tags: ["q"] },
          execution_count: 3,
          source: ["SELECT * FROM orders"],
          outputs: [{ output_type: "stream", name: "stdout", text: ["bound\n"] }],
        },
      ],
      nbformat: 4,
      nbformat_minor: 5,
    });
    const nb = parseNotebook(text);
    const cell = nb.cells[0];
    expect(cell.cellType).toBe("sql");
    expect(cell.sqlConnectionId).toBe("conn-1");
    expect(cell.sqlVarName).toBe("orders");
    expect(cell.source).toBe("SELECT * FROM orders");
    expect(cell.executionCount).toBe(3);
    expect(cell.outputs).toHaveLength(1);
    // The arris tag is lifted into fields and stripped from preserved metadata.
    expect(cell.metadata).toEqual({ tags: ["q"] });
  });

  it("serializes a SQL cell back to a code cell tagged via metadata.arris", () => {
    const cell: NotebookCell = {
      id: "x",
      cellType: "sql",
      source: "SELECT 1",
      outputs: [],
      executionCount: 7,
      metadata: { tags: ["q"] },
      rendered: false,
      pendingMsgId: null,
      sqlConnectionId: "conn-9",
      sqlVarName: "df2",
    };
    const raw = JSON.parse(
      serializeNotebook({ cells: [cell], metadata: {}, nbformatMinor: 5 }),
    );
    expect(raw.cells[0].cell_type).toBe("code");
    expect(raw.cells[0].metadata.arris).toEqual({
      kind: "sql",
      connectionId: "conn-9",
      varName: "df2",
    });
    expect(raw.cells[0].metadata.tags).toEqual(["q"]);
    expect(raw.cells[0].execution_count).toBe(7);
  });

  it("round-trips a SQL cell through serialize → parse", () => {
    const cell: NotebookCell = {
      id: "x",
      cellType: "sql",
      source: "SELECT * FROM t",
      outputs: [],
      executionCount: null,
      metadata: {},
      rendered: false,
      pendingMsgId: null,
      sqlConnectionId: "c1",
      sqlVarName: "df1",
    };
    const text = serializeNotebook({ cells: [cell], metadata: {}, nbformatMinor: 5 });
    const back = parseNotebook(text).cells[0];
    expect(back.cellType).toBe("sql");
    expect(back.sqlConnectionId).toBe("c1");
    expect(back.sqlVarName).toBe("df1");
    expect(back.source).toBe("SELECT * FROM t");
  });
});
