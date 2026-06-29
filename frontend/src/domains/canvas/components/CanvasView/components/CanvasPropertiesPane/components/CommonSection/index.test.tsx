import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { makeComponent } from "../../../../../../utils";
import { CommonSection } from "./index";

const comp = makeComponent({ kind: "shape", id: "s", shape: "rect", x: 10, y: 20, w: 100, h: 50 });

describe("CommonSection", () => {
  it("writes geometry edits back through onChange", () => {
    const onChange = vi.fn();
    const { container } = render(
      <CommonSection tabId="t" component={comp} onChange={onChange} />,
    );
    const numbers = container.querySelectorAll('input[type="number"]');
    expect(numbers).toHaveLength(4);
    fireEvent.change(numbers[0], { target: { value: "33" } });
    expect(onChange).toHaveBeenCalledWith({ x: 33 });
    fireEvent.change(numbers[2], { target: { value: "200" } });
    expect(onChange).toHaveBeenCalledWith({ w: 200 });
  });

  it("clamps width/height to at least 1", () => {
    const onChange = vi.fn();
    const { container } = render(
      <CommonSection tabId="t" component={comp} onChange={onChange} />,
    );
    const numbers = container.querySelectorAll('input[type="number"]');
    fireEvent.change(numbers[3], { target: { value: "-5" } });
    expect(onChange).toHaveBeenCalledWith({ h: 1 });
  });

  it("toggles the lock flag", () => {
    const onChange = vi.fn();
    const { container } = render(
      <CommonSection tabId="t" component={comp} onChange={onChange} />,
    );
    const check = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(check);
    expect(onChange).toHaveBeenCalledWith({ locked: true });
  });
});
