import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Btn } from "./index";

describe("Btn", () => {
  it("renders mdbc button with variant class", () => {
    render(<Btn variant="primary">Run</Btn>);
    const button = screen.getByRole("button", { name: "Run" });
    expect(button.className).toContain("mdbc-btn");
    expect(button.className).toContain("primary");
  });

  it("calls onClick when enabled", () => {
    const onClick = vi.fn();
    render(<Btn onClick={onClick}>Run</Btn>);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
