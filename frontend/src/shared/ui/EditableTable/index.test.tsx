import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { EditableTable } from "./index";
import type { EditableTableColumn, EditableTableRow } from "./types";

const COLUMNS: EditableTableColumn[] = [
  { key: "name", label: "Name" },
  { key: "value", label: "Value" },
];

// Controlled harness so onChange feeds back into rows, mirroring real usage.
function Harness({ initial }: { initial: EditableTableRow[] }) {
  const [rows, setRows] = useState<EditableTableRow[]>(initial);
  return (
    <EditableTable
      columns={COLUMNS}
      rows={rows}
      onChange={setRows}
      emptyLabel="No path variables"
      testId="t"
    />
  );
}

function isDisabled(testId: string): boolean {
  return (screen.getByTestId(testId) as HTMLButtonElement).disabled;
}

describe("EditableTable", () => {
  it("renders column headers and the empty label when there are no rows", () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Value")).toBeTruthy();
    expect(screen.getByTestId("t-empty").textContent).toBe("No path variables");
  });

  it("disables remove and edit until a row is selected", () => {
    render(<Harness initial={[{ name: "HOME", value: "/home" }]} />);
    expect(isDisabled("t-remove")).toBe(true);
    expect(isDisabled("t-edit")).toBe(true);
    fireEvent.click(screen.getByTestId("t-row-0"));
    expect(isDisabled("t-remove")).toBe(false);
    expect(isDisabled("t-edit")).toBe(false);
  });

  it("adds a row through the add toolbar button", () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByTestId("t-add"));
    fireEvent.change(screen.getByTestId("t-input-name"), { target: { value: "HOME" } });
    fireEvent.change(screen.getByTestId("t-input-value"), { target: { value: "/home" } });
    fireEvent.keyDown(screen.getByTestId("t-input-value"), { key: "Enter" });
    const row = screen.getByTestId("t-row-0");
    expect(within(row).getByText("HOME")).toBeTruthy();
    expect(within(row).getByText("/home")).toBeTruthy();
  });

  it("ignores an all-blank add", () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByTestId("t-add"));
    fireEvent.keyDown(screen.getByTestId("t-input-name"), { key: "Enter" });
    expect(screen.queryByTestId("t-row-0")).toBeNull();
    expect(screen.queryByTestId("t-empty")).not.toBeNull();
  });

  it("cancels an add on Escape", () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByTestId("t-add"));
    fireEvent.change(screen.getByTestId("t-input-name"), { target: { value: "X" } });
    fireEvent.keyDown(screen.getByTestId("t-input-name"), { key: "Escape" });
    expect(screen.queryByTestId("t-row-0")).toBeNull();
  });

  it("edits the selected row", () => {
    render(<Harness initial={[{ name: "HOME", value: "/home" }]} />);
    fireEvent.click(screen.getByTestId("t-row-0"));
    fireEvent.click(screen.getByTestId("t-edit"));
    fireEvent.change(screen.getByTestId("t-input-value"), { target: { value: "/root" } });
    fireEvent.keyDown(screen.getByTestId("t-input-value"), { key: "Enter" });
    expect(within(screen.getByTestId("t-row-0")).getByText("/root")).toBeTruthy();
  });

  it("edits a row on double-click", () => {
    render(<Harness initial={[{ name: "HOME", value: "/home" }]} />);
    fireEvent.doubleClick(screen.getByTestId("t-row-0"));
    fireEvent.change(screen.getByTestId("t-input-name"), { target: { value: "ROOT" } });
    fireEvent.keyDown(screen.getByTestId("t-input-name"), { key: "Enter" });
    expect(within(screen.getByTestId("t-row-0")).getByText("ROOT")).toBeTruthy();
  });

  it("removes the selected row", () => {
    render(<Harness initial={[{ name: "A", value: "1" }, { name: "B", value: "2" }]} />);
    fireEvent.click(screen.getByTestId("t-row-0"));
    fireEvent.click(screen.getByTestId("t-remove"));
    expect(screen.queryByText("A")).toBeNull();
    expect(screen.getByText("B")).toBeTruthy();
  });
});
