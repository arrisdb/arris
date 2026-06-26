import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Toggle } from "./index";

describe("Toggle", () => {
  it("renders switch state and toggles", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} ariaLabel="Use SSL" />);
    const toggle = screen.getByRole("switch", { name: "Use SSL" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
