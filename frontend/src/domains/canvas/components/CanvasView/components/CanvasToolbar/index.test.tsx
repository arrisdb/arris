import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import type { CanvasToolbarProps } from "../../types";
import { CanvasToolbar } from "./index";

function setup(overrides: Partial<CanvasToolbarProps> = {}) {
  const props: CanvasToolbarProps = {
    mode: "move",
    onModeChange: vi.fn(),
    onAddQuery: vi.fn(),
    onAddChart: vi.fn(),
    onAddTable: vi.fn(),
    onAddSticky: vi.fn(),
    onAddText: vi.fn(),
    onAddShape: vi.fn(),
    onRunAll: vi.fn(),
    ...overrides,
  };
  render(<CanvasToolbar {...props} />);
  return props;
}

describe("CanvasToolbar", () => {
  it("adds an object for each single-action tool", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("canvas-tool-text"));
    fireEvent.click(screen.getByTestId("canvas-tool-sticky"));
    fireEvent.click(screen.getByTestId("canvas-tool-chart"));
    fireEvent.click(screen.getByTestId("canvas-tool-table"));
    fireEvent.click(screen.getByTestId("canvas-tool-query"));
    expect(props.onAddText).toHaveBeenCalledTimes(1);
    expect(props.onAddSticky).toHaveBeenCalledTimes(1);
    expect(props.onAddChart).toHaveBeenCalledTimes(1);
    expect(props.onAddTable).toHaveBeenCalledTimes(1);
    expect(props.onAddQuery).toHaveBeenCalledTimes(1);
  });

  it("runs all queries from the Run all button", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("canvas-tool-run-all"));
    expect(props.onRunAll).toHaveBeenCalledTimes(1);
  });

  it("wraps every tool in a tooltip carrying its label", () => {
    setup();
    const tips = Array.from(document.querySelectorAll(".mdbc-tooltip-label")).map(
      (el) => el.textContent,
    );
    expect(tips).toContain("Select");
    expect(tips).toContain("Query cell");
    expect(tips).toContain("Chart");
    expect(tips).toContain("Run all queries");
  });

  it("picks a shape kind from the shape menu", () => {
    const props = setup();
    expect(screen.queryByTestId("canvas-tool-shape-ellipse")).toBeNull();
    fireEvent.click(screen.getByTestId("canvas-tool-shape-caret"));
    fireEvent.click(screen.getByTestId("canvas-tool-shape-ellipse"));
    expect(props.onAddShape).toHaveBeenCalledWith("ellipse");
  });

  it("switches the pointer mode from the select menu", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("canvas-tool-select-caret"));
    fireEvent.click(screen.getByTestId("canvas-tool-select-hand"));
    expect(props.onModeChange).toHaveBeenCalledWith("hand");
  });

  it("enters connect mode from the Arrow option", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("canvas-tool-select-caret"));
    fireEvent.click(screen.getByTestId("canvas-tool-select-connect"));
    expect(props.onModeChange).toHaveBeenCalledWith("connect");
  });

  it("does not fire for the disabled Python option", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("canvas-tool-query-caret"));
    fireEvent.click(screen.getByTestId("canvas-tool-query-python"));
    // Python is not implemented yet: clicking it must not add a query object.
    expect(props.onAddQuery).not.toHaveBeenCalled();
  });

  it("clicking an expandable tool applies its default option and opens the menu", () => {
    const props = setup();
    // No menu open yet.
    expect(screen.queryByTestId("canvas-tool-shape-ellipse")).toBeNull();
    fireEvent.click(screen.getByTestId("canvas-tool-shape"));
    // Default option (rect) fires, and the menu is shown for a quick switch.
    expect(props.onAddShape).toHaveBeenCalledWith("rect");
    expect(screen.getByTestId("canvas-tool-shape-ellipse")).toBeTruthy();
  });

  it("remembers the last option so the main button re-applies it", () => {
    const props = setup();
    fireEvent.click(screen.getByTestId("canvas-tool-shape-caret"));
    fireEvent.click(screen.getByTestId("canvas-tool-shape-ellipse"));
    expect(props.onAddShape).toHaveBeenLastCalledWith("ellipse");
    // Clicking the main button now repeats the remembered choice, not rect.
    fireEvent.click(screen.getByTestId("canvas-tool-shape"));
    expect(props.onAddShape).toHaveBeenLastCalledWith("ellipse");
  });

  it("dismisses an open menu when clicking outside the toolbar (e.g. the canvas)", () => {
    setup();
    fireEvent.click(screen.getByTestId("canvas-tool-shape-caret"));
    expect(screen.getByTestId("canvas-tool-shape-ellipse")).toBeTruthy();
    // A mousedown anywhere outside the toolbar closes the menu.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("canvas-tool-shape-ellipse")).toBeNull();
  });

  it("closes an open menu when another tool is used", () => {
    setup();
    fireEvent.click(screen.getByTestId("canvas-tool-shape-caret"));
    expect(screen.getByTestId("canvas-tool-shape-ellipse")).toBeTruthy();
    fireEvent.click(screen.getByTestId("canvas-tool-text"));
    expect(screen.queryByTestId("canvas-tool-shape-ellipse")).toBeNull();
  });
});
