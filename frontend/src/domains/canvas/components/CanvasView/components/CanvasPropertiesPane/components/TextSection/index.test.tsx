import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { makeComponent } from "../../../../../../utils";
import { TextSection } from "./index";

describe("TextSection", () => {
  it("writes font size and toggles bold", () => {
    const onChange = vi.fn();
    const comp = makeComponent({ kind: "text", id: "t" });
    const { container, getByTitle } = render(
      <TextSection tabId="t" component={comp} onChange={onChange} />,
    );
    const size = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(size, { target: { value: "24" } });
    expect(onChange).toHaveBeenCalledWith({ style: { fontSize: 24 } });

    fireEvent.click(getByTitle("Bold"));
    expect(onChange).toHaveBeenCalledWith({ style: { bold: true } });
  });

  it("writes alignment", () => {
    const onChange = vi.fn();
    const comp = makeComponent({ kind: "text", id: "t" });
    const { getByTitle } = render(
      <TextSection tabId="t" component={comp} onChange={onChange} />,
    );
    fireEvent.click(getByTitle("Align center"));
    expect(onChange).toHaveBeenCalledWith({ style: { align: "center" } });
  });

  it("renders nothing for a non-text object", () => {
    const comp = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const { container } = render(
      <TextSection tabId="t" component={comp} onChange={vi.fn()} />,
    );
    expect(container.querySelector(".mdbc-pane-form")).toBeNull();
  });

  it("uses the shared NumberStepper and the small colour swatch", () => {
    const comp = makeComponent({ kind: "text", id: "t" });
    const { container } = render(
      <TextSection tabId="t" component={comp} onChange={vi.fn()} />,
    );
    // Font size is a shared NumberStepper; colour is the compact swatch.
    expect(container.querySelectorAll(".mdbc-stepper")).toHaveLength(1);
    expect(container.querySelectorAll(".mdbc-canvas-color")).toHaveLength(1);
  });
});
