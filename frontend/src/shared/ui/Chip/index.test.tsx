import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Chip } from "./index";

describe("Chip", () => {
  it("renders active status chip", () => {
    render(<Chip active status="success">Done</Chip>);
    const chip = screen.getByText("Done").closest(".mdbc-chip") as HTMLElement;
    expect(chip.className).toContain("active");
    expect(chip.className).toContain("success");
    expect(chip.querySelector(".ledot")).toBeTruthy();
  });

  it("stops close click from triggering chip click", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(<Chip onClick={onClick} onClose={onClose}>Pinned</Chip>);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
