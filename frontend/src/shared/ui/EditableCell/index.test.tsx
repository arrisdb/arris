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

  it("renders a truncated single-line preview for long values", () => {
    const long = JSON.stringify({ items: Array.from({ length: 200 }, (_, i) => i) });
    render(
      <EditableCell readOnly value={{ kind: "json", value: long } as any} onCommit={() => {}} />,
    );
    const cell = document.querySelector(".mdbc-editable-cell-readonly-value") as HTMLElement;
    expect(cell.textContent!.length).toBeLessThan(long.length);
    expect(cell.textContent!.endsWith("…")).toBe(true);
  });

  it("collapses newlines into a single-line preview", () => {
    render(
      <EditableCell
        readOnly
        value={{ kind: "text", value: "line one\nline two\nline three" } as any}
        onCommit={() => {}}
      />,
    );
    const cell = document.querySelector(".mdbc-editable-cell-readonly-value") as HTMLElement;
    expect(cell.textContent).toBe("line one line two line three");
  });

  it("edits the full value, not the truncated preview", () => {
    const onCommit = vi.fn();
    const long = "x".repeat(800);
    render(
      <EditableCell value={{ kind: "text", value: long } as any} onCommit={onCommit} />,
    );
    const cell = document.querySelector(".mdbc-editable-cell-display") as HTMLElement;
    fireEvent.doubleClick(cell);
    // The input is seeded with the full value, not the truncated cell preview.
    expect(screen.getByDisplayValue(long)).toBeTruthy();
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
