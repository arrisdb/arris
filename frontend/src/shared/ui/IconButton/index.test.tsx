import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IconButton } from "./index";

describe("IconButton", () => {
  it("renders standardized icon-only button classes and accessible label", () => {
    render(<IconButton icon="sparkles" label="Generate SQL" variant="primary" />);
    const button = screen.getByRole("button", { name: "Generate SQL" });

    expect(button.classList.contains("mdbc-btn")).toBe(true);
    expect(button.classList.contains("primary")).toBe(true);
    expect(button.classList.contains("icon-only")).toBe(true);
    expect(button.getAttribute("title")).toBe("Generate SQL");
    expect(button.querySelector("svg")).toBeTruthy();
  });

  it("supports active state, extra classes, and click handlers", () => {
    const onClick = vi.fn();
    render(
      <IconButton
        icon="filter"
        label="Filter"
        variant="ghost"
        active
        className="extra-class"
        onClick={onClick}
      />,
    );

    const button = screen.getByRole("button", { name: "Filter" });
    expect(button.classList.contains("ghost")).toBe(true);
    expect(button.classList.contains("active")).toBe(true);
    expect(button.classList.contains("extra-class")).toBe(true);

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders the loading icon with spin class", () => {
    render(<IconButton icon="arrowUp" label="Upload" loading />);
    const svg = screen.getByRole("button", { name: "Upload" }).querySelector("svg");

    expect(svg?.classList.contains("mdbc-spin")).toBe(true);
  });
});
