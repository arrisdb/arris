import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DbtToolbar } from "./index";
import type { DbtToolbarProps } from "./types";

function props(overrides?: Partial<DbtToolbarProps>): DbtToolbarProps {
  return {
    isDbtModel: true,
    runningCommand: null,
    shortcut: () => undefined,
    selector: "stg_customers",
    setSelector: vi.fn(),
    primaryAction: null,
    onSelectAction: vi.fn(),
    showCompiled: false,
    setShowCompiled: vi.fn(),
    showLineage: false,
    setShowLineage: vi.fn(),
    showDocs: false,
    isCompiling: false,
    isGeneratingDocs: false,
    isPreviewing: false,
    handleDbtRun: vi.fn(),
    handleDbtTest: vi.fn(),
    handleDbtBuild: vi.fn(),
    handleDbtCompile: vi.fn(),
    handleDbtDocs: vi.fn(),
    handleDbtPreview: vi.fn(),
    showDiffConfig: false,
    onToggleDiffConfig: vi.fn(),
    ...overrides,
  };
}

describe("DbtToolbar", () => {
  it("defaults the primary to Run and runs the selector", () => {
    const p = props();
    render(<DbtToolbar {...p} />);
    expect(screen.getByTestId("dbt-splitbutton-primary").textContent).toContain("Run");
    fireEvent.click(screen.getByTestId("dbt-splitbutton-primary"));
    expect(p.handleDbtRun).toHaveBeenCalledWith("stg_customers");
  });

  it("reflects the owner-driven primary action", () => {
    render(<DbtToolbar {...props({ primaryAction: "docs" })} />);
    expect(screen.getByTestId("dbt-splitbutton-primary").textContent).toContain("Docs");
  });

  it("seeds the inline selector input from the selector prop", () => {
    render(<DbtToolbar {...props()} />);
    fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle"));
    expect(screen.getAllByDisplayValue("stg_customers")).toHaveLength(3);
  });

  it("pushes inline selector edits up via setSelector", () => {
    const p = props();
    render(<DbtToolbar {...p} />);
    fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle"));
    fireEvent.change(screen.getByTestId("dbt-splitbutton-scope-test"), { target: { value: "+stg_customers" } });
    expect(p.setSelector).toHaveBeenCalledWith("+stg_customers");
  });

  it("runs the current selector and promotes the picked action", () => {
    const p = props();
    render(<DbtToolbar {...p} />);
    fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle"));
    fireEvent.click(screen.getByTestId("dbt-splitbutton-item-test"));
    expect(p.handleDbtTest).toHaveBeenCalledWith("stg_customers");
    expect(p.onSelectAction).toHaveBeenCalledWith("test");
  });

  it("toggles the inline diff config from the model dropdown", () => {
    const p = props();
    render(<DbtToolbar {...p} />);
    fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle"));
    fireEvent.click(screen.getByTestId("dbt-splitbutton-item-diff"));
    expect(p.onToggleDiffConfig).toHaveBeenCalledTimes(1);
  });

  it("renders a Test-first split button for non-model nodes", () => {
    const p = props({ isDbtModel: false });
    render(<DbtToolbar {...p} />);
    const primary = screen.getByTestId("dbt-splitbutton-primary");
    expect(primary.textContent).toContain("Test");
    fireEvent.click(primary);
    expect(p.handleDbtTest).toHaveBeenCalledWith("stg_customers");
  });

  it("limits the non-model dropdown to Test, Build, Compile and Lineage", () => {
    render(<DbtToolbar {...props({ isDbtModel: false })} />);
    fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle"));
    expect(screen.getByTestId("dbt-splitbutton-item-test")).toBeTruthy();
    expect(screen.getByTestId("dbt-splitbutton-item-build")).toBeTruthy();
    expect(screen.getByTestId("dbt-splitbutton-item-compile")).toBeTruthy();
    expect(screen.getByTestId("dbt-splitbutton-item-lineage")).toBeTruthy();
    expect(screen.queryByTestId("dbt-splitbutton-item-run")).toBeNull();
    expect(screen.queryByTestId("dbt-splitbutton-item-preview")).toBeNull();
    expect(screen.queryByTestId("dbt-splitbutton-item-docs")).toBeNull();
  });
});
