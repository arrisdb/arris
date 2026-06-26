import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditableCell } from "./index";

describe("EditableCell", () => {
  it("renders readonly null values with readonly class", () => {
    render(
      <EditableCell
        readOnly
        value={{ kind: "null" } as any}
        onCommit={() => {}}
      />,
    );
    const cell = screen.getByText("NULL");
    expect(cell.className).toContain("mdbc-editable-cell-readonly-value");
  });

  it("commits edited text on Enter", () => {
    const onCommit = vi.fn();
    render(
      <EditableCell
        value={{ kind: "text", value: "old" } as any}
        onCommit={onCommit}
      />,
    );
    fireEvent.doubleClick(screen.getByText("old"));
    const input = screen.getByDisplayValue("old");
    fireEvent.change(input, { target: { value: "new" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({ kind: "text", value: "new" });
  });
});
