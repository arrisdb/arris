import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Field } from "./index";

describe("Field", () => {
  it("emits changed value and supports monospace class", () => {
    const onChange = vi.fn();
    render(<Field value="abc" onChange={onChange} monospace />);
    const input = screen.getByDisplayValue("abc");
    expect(input.className).toContain("mdbc-field");
    expect(input.className).toContain("mono");
    fireEvent.change(input, { target: { value: "def" } });
    expect(onChange).toHaveBeenCalledWith("def");
  });
});
