import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { makeComponent } from "../../../../../../utils";
import { ShapeSection } from "./index";

describe("ShapeSection", () => {
  it("writes fill and corner radius for a rectangle", () => {
    const onChange = vi.fn();
    const comp = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const { container } = render(
      <ShapeSection tabId="t" component={comp} onChange={onChange} />,
    );
    const fill = container.querySelector('input[type="color"]') as HTMLInputElement;
    fireEvent.change(fill, { target: { value: "#112233" } });
    expect(onChange).toHaveBeenCalledWith({ style: { fill: "#112233" } });

    const radius = container.querySelectorAll('input[type="number"]');
    // [strokeWidth, cornerRadius]
    fireEvent.change(radius[1], { target: { value: "8" } });
    expect(onChange).toHaveBeenCalledWith({ radius: 8 });
  });

  it("hides fill and corner radius for a line", () => {
    const onChange = vi.fn();
    const comp = makeComponent({ kind: "shape", id: "s", shape: "line" });
    const { container } = render(
      <ShapeSection tabId="t" component={comp} onChange={onChange} />,
    );
    // No fill swatch and no corner-radius field for a line (only stroke colour +
    // stroke width remain).
    expect(container.querySelectorAll('input[type="color"]')).toHaveLength(1);
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(1);
  });

  it("renders nothing for a non-shape object", () => {
    const comp = makeComponent({ kind: "text", id: "x" });
    const { container } = render(
      <ShapeSection tabId="t" component={comp} onChange={vi.fn()} />,
    );
    expect(container.querySelector(".mdbc-pane-form")).toBeNull();
  });

  it("uses the shared NumberStepper and the small colour swatch", () => {
    const comp = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const { container } = render(
      <ShapeSection tabId="t" component={comp} onChange={vi.fn()} />,
    );
    // Stroke width + corner radius are shared NumberSteppers.
    expect(container.querySelectorAll(".mdbc-stepper")).toHaveLength(2);
    // Fill + stroke are the compact swatch, not a full-width bar.
    expect(container.querySelectorAll(".mdbc-canvas-color")).toHaveLength(2);
  });
});
