import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { SegmentedIconRow } from "./index";

const OPTIONS = [
  { id: "left" as const, icon: "alignLeft" as const, title: "Align left" },
  { id: "center" as const, icon: "alignCenter" as const, title: "Align center" },
];

describe("SegmentedIconRow", () => {
  it("marks the active option and fires onSelect with its id", () => {
    const onSelect = vi.fn();
    render(
      <SegmentedIconRow
        label="Align"
        options={OPTIONS}
        isActive={(id) => id === "left"}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByLabelText("Align left").className).toContain("active");
    expect(screen.getByLabelText("Align center").className).not.toContain("active");
    fireEvent.click(screen.getByLabelText("Align center"));
    expect(onSelect).toHaveBeenCalledWith("center");
  });

  it("renders the row label", () => {
    render(
      <SegmentedIconRow label="Style" options={OPTIONS} isActive={() => false} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Style")).toBeTruthy();
  });
});
