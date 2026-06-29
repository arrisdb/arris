import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { makeComponent } from "../../../../../../utils";
import { StickySection } from "./index";

describe("StickySection", () => {
  it("shows the current tint and writes a new one", () => {
    const onChange = vi.fn();
    const comp = makeComponent({ kind: "sticky", id: "n", color: "yellow" });
    const { getByTestId, getByText } = render(
      <StickySection tabId="t" component={comp} onChange={onChange} />,
    );
    fireEvent.click(getByTestId("sticky-color-select"));
    fireEvent.click(getByText("Blue"));
    expect(onChange).toHaveBeenCalledWith({ color: "blue" });
  });

  it("renders nothing for a non-sticky object", () => {
    const comp = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const { container } = render(
      <StickySection tabId="t" component={comp} onChange={vi.fn()} />,
    );
    expect(container.querySelector(".mdbc-pane-form")).toBeNull();
  });
});
