import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SplitButton } from "./index";
import type { SplitButtonItem } from "./index";

describe("SplitButton", () => {
  it("renders the first item as the primary action and fires it on click", () => {
    const onRun = vi.fn();
    const items: SplitButtonItem[] = [{ id: "run", label: "Run", onClick: onRun }];
    render(<SplitButton items={items} data-testid="sb" />);
    expect(screen.getByTestId("sb-primary").textContent).toContain("Run");
    fireEvent.click(screen.getByTestId("sb-primary"));
    expect(onRun).toHaveBeenCalledOnce();
  });

  it("keeps the menu closed until the toggle is clicked", () => {
    const items: SplitButtonItem[] = [{ id: "run", label: "Run", onClick: vi.fn() }];
    render(<SplitButton items={items} data-testid="sb" />);
    expect(screen.queryByTestId("sb-item-run")).toBeNull();
    fireEvent.click(screen.getByTestId("sb-toggle"));
    expect(screen.getByTestId("sb-item-run")).toBeTruthy();
  });

  it("promotes a picked item to the primary action and runs it", () => {
    const onRun = vi.fn();
    const onTest = vi.fn();
    const items: SplitButtonItem[] = [
      { id: "run", label: "Run", onClick: onRun },
      { id: "test", label: "Test", onClick: onTest },
    ];
    render(<SplitButton items={items} data-testid="sb" />);
    fireEvent.click(screen.getByTestId("sb-toggle"));
    fireEvent.click(screen.getByTestId("sb-item-test"));
    expect(onTest).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("sb-item-test")).toBeNull(); // menu closed
    expect(screen.getByTestId("sb-primary").textContent).toContain("Test");
  });

  it("renders the scope chip and shortcut hint for an item", () => {
    const items: SplitButtonItem[] = [
      { id: "test", label: "Test", scope: "+model+", shortcut: "⌘⇧T", onClick: vi.fn() },
    ];
    render(<SplitButton items={items} data-testid="sb" />);
    fireEvent.click(screen.getByTestId("sb-toggle"));
    expect(screen.getByText("+model+")).toBeTruthy();
    expect(screen.getByText("⌘⇧T")).toBeTruthy();
  });

  it("renders an editable scope input and fires onScopeChange without running or closing", () => {
    const onRun = vi.fn();
    const onScopeChange = vi.fn();
    const items: SplitButtonItem[] = [
      { id: "run", label: "Run", scope: "model", scopeEditable: true, onScopeChange, onClick: onRun },
    ];
    render(<SplitButton items={items} data-testid="sb" />);
    fireEvent.click(screen.getByTestId("sb-toggle"));
    const input = screen.getByTestId("sb-scope-run");
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: "+model" } });
    expect(onScopeChange).toHaveBeenCalledWith("+model");
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.getByTestId("sb-item-run")).toBeTruthy(); // still open
  });

  it("applies the full-width modifier class when fullWidth is set", () => {
    const items: SplitButtonItem[] = [{ id: "run", label: "Run", onClick: vi.fn() }];
    render(<SplitButton items={items} fullWidth data-testid="sb" />);
    expect(screen.getByTestId("sb").className).toContain("full");
  });

  it("renders the scope input placeholder when the scope is empty", () => {
    const items: SplitButtonItem[] = [
      {
        id: "run",
        label: "Run",
        scope: "",
        scopeEditable: true,
        scopePlaceholder: "whole project",
        onScopeChange: vi.fn(),
        onClick: vi.fn(),
      },
    ];
    render(<SplitButton items={items} data-testid="sb" />);
    fireEvent.click(screen.getByTestId("sb-toggle"));
    expect(screen.getByTestId("sb-scope-run").getAttribute("placeholder")).toBe("whole project");
  });

  it("does not fire a disabled item's onClick", () => {
    const onItem = vi.fn();
    const items: SplitButtonItem[] = [{ id: "test", label: "Test", disabled: true, onClick: onItem }];
    render(<SplitButton items={items} data-testid="sb" />);
    fireEvent.click(screen.getByTestId("sb-toggle"));
    fireEvent.click(screen.getByTestId("sb-item-test"));
    expect(onItem).not.toHaveBeenCalled();
  });
});
