import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DbtDiffView } from "./index";
import type { SlimDiffResult } from "@shared";

const emptySample = { columns: [], rows: [], elapsed: 0 };

const result: SlimDiffResult = {
  mode: "inline",
  prodTotal: 10,
  newTotal: 12,
  addedCount: 3,
  removedCount: 1,
  updatedCount: 0,
  keyColumns: [],
  sharedColumns: ["id"],
  prodOnlyColumns: [],
  newOnlyColumns: ["new_col"],
  addedSample: {
    columns: [{ name: "id", type_hint: "int" }],
    rows: [[{ kind: "int", value: 7 }]],
    elapsed: 0,
  },
  removedSample: { columns: [{ name: "id", type_hint: "int" }], rows: [], elapsed: 0 },
  updatedNewSample: emptySample,
  updatedProdSample: emptySample,
  sql: "-- row counts\nSELECT 1",
};

describe("DbtDiffView", () => {
  it("renders the summary counts", () => {
    render(<DbtDiffView result={result} />);
    expect(screen.getByText("+3 added")).toBeTruthy();
    expect(screen.getByText("−1 removed")).toBeTruthy();
    expect(screen.getByText("prod: 10")).toBeTruthy();
    expect(screen.getByText("new: 12")).toBeTruthy();
  });

  it("renders the schema delta when columns differ", () => {
    render(<DbtDiffView result={result} />);
    expect(screen.getByText(/Schema change: \+new_col/)).toBeTruthy();
  });

  it("renders added sample rows and an empty hint for removed", () => {
    render(<DbtDiffView result={result} />);
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("No rows.")).toBeTruthy();
  });

  it("hides updated section and chip for a keyless diff", () => {
    render(<DbtDiffView result={result} />);
    expect(screen.queryByTestId("diff-updated-section")).toBeNull();
    expect(screen.queryByTestId("diff-updated-count")).toBeNull();
  });

  it("shows the updated count, key chip, and stacked old/new grids when keyed", () => {
    const keyed: SlimDiffResult = {
      ...result,
      updatedCount: 2,
      keyColumns: ["id"],
      updatedProdSample: {
        columns: [{ name: "id", type_hint: "int" }, { name: "amount", type_hint: "int" }],
        rows: [[{ kind: "int", value: 9 }, { kind: "int", value: 100 }]],
        elapsed: 0,
      },
      updatedNewSample: {
        columns: [{ name: "id", type_hint: "int" }, { name: "amount", type_hint: "int" }],
        rows: [[{ kind: "int", value: 9 }, { kind: "int", value: 120 }]],
        elapsed: 0,
      },
    };
    render(<DbtDiffView result={keyed} />);
    expect(screen.getByTestId("diff-updated-count").textContent).toContain("2 updated");
    expect(screen.getByTestId("diff-key-columns").textContent).toContain("id");
    expect(screen.getByTestId("diff-updated-section")).toBeTruthy();

    // One row per key: the changed cell shows old → new inline (old red/struck,
    // new green); the unchanged key value appears once, plainly.
    expect(screen.getByText("100").className).toBe("mdbc-diff-old");
    expect(screen.getByText("120").className).toBe("mdbc-diff-new");
    const idCells = screen.getAllByText("7");
    expect(idCells).toHaveLength(1);
    expect(idCells[0].className).toBe("");
  });
});
