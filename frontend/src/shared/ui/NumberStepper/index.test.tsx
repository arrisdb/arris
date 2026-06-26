import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NumberStepper } from "./index";

describe("NumberStepper", () => {
  it("renders value in input", () => {
    render(<NumberStepper value={14} onChange={() => {}} min={10} max={20} />);
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("14");
  });

  it("calls onChange with incremented value on + click", () => {
    const onChange = vi.fn();
    render(<NumberStepper value={14} onChange={onChange} min={10} max={20} step={1} />);
    fireEvent.click(screen.getByLabelText("Increase"));
    expect(onChange).toHaveBeenCalledWith(15);
  });

  it("calls onChange with decremented value on - click", () => {
    const onChange = vi.fn();
    render(<NumberStepper value={14} onChange={onChange} min={10} max={20} step={1} />);
    fireEvent.click(screen.getByLabelText("Decrease"));
    expect(onChange).toHaveBeenCalledWith(13);
  });

  it("disables decrease button at min", () => {
    render(<NumberStepper value={10} onChange={() => {}} min={10} max={20} />);
    expect((screen.getByLabelText("Decrease") as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables increase button at max", () => {
    render(<NumberStepper value={20} onChange={() => {}} min={10} max={20} />);
    expect((screen.getByLabelText("Increase") as HTMLButtonElement).disabled).toBe(true);
  });

  it("clamps typed value to max", () => {
    const onChange = vi.fn();
    render(<NumberStepper value={15} onChange={onChange} min={10} max={20} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "25" } });
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it("clamps typed value to min", () => {
    const onChange = vi.fn();
    render(<NumberStepper value={15} onChange={onChange} min={10} max={20} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "5" } });
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("handles fractional step correctly", () => {
    const onChange = vi.fn();
    render(<NumberStepper value={14.5} onChange={onChange} min={10} max={20} step={0.5} />);
    fireEvent.click(screen.getByLabelText("Increase"));
    expect(onChange).toHaveBeenCalledWith(15);
  });

  it("renders suffix when provided", () => {
    render(<NumberStepper value={50} onChange={() => {}} min={0} max={100} suffix="%" />);
    expect(screen.getByText("%")).toBeTruthy();
  });
});
