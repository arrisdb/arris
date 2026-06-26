import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SqlMeshToolbar } from "./index";
import type { SqlMeshToolbarProps } from "./types";

function props(overrides?: Partial<SqlMeshToolbarProps>): SqlMeshToolbarProps {
  return {
    isSqlMeshPythonModel: false,
    smRunningCommand: null,
    shortcut: () => undefined,
    selector: "orders",
    setSelector: vi.fn(),
    primaryAction: null,
    onSelectAction: vi.fn(),
    showRendered: false,
    setShowRendered: vi.fn(),
    showLineage: false,
    setShowLineage: vi.fn(),
    isRendering: false,
    isPreviewing: false,
    handleSmPlan: vi.fn(),
    handleSmRun: vi.fn(),
    handleSmTest: vi.fn(),
    handleSmRender: vi.fn(),
    handleSmLint: vi.fn(),
    handleSmAudit: vi.fn(),
    handleSmPreview: vi.fn(),
    ...overrides,
  };
}

describe("SqlMeshToolbar", () => {
  it("defaults the primary to Plan and runs it with the selector prop", () => {
    const p = props();
    render(<SqlMeshToolbar {...p} />);
    expect(screen.getByTestId("sqlmesh-splitbutton-primary").textContent).toContain("Plan");
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-primary"));
    expect(p.handleSmPlan).toHaveBeenCalledWith("orders");
  });

  it("reflects the owner-driven primary action", () => {
    render(<SqlMeshToolbar {...props({ primaryAction: "render" })} />);
    expect(screen.getByTestId("sqlmesh-splitbutton-primary").textContent).toContain("Render");
  });

  it("seeds the inline plan selector input from the selector prop", () => {
    render(<SqlMeshToolbar {...props()} />);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    expect(screen.getByTestId("sqlmesh-splitbutton-scope-plan").getAttribute("value")).toBe("orders");
  });

  it("pushes inline plan selector edits up via setSelector", () => {
    const p = props();
    render(<SqlMeshToolbar {...p} />);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    fireEvent.change(screen.getByTestId("sqlmesh-splitbutton-scope-plan"), {
      target: { value: "+orders" },
    });
    expect(p.setSelector).toHaveBeenCalledWith("+orders");
  });

  it("plans the current selector prop, not an edited local value", () => {
    const p = props({ selector: "orders+" });
    render(<SqlMeshToolbar {...p} />);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-primary"));
    expect(p.handleSmPlan).toHaveBeenCalledWith("orders+");
  });

  it("exposes Plan, Run, Test, Render, Lint, Audit, Lineage and Preview in the dropdown", () => {
    render(<SqlMeshToolbar {...props()} />);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    for (const id of ["plan", "run", "test", "render", "lint", "audit", "lineage", "preview"]) {
      expect(screen.getByTestId(`sqlmesh-splitbutton-item-${id}`)).toBeTruthy();
    }
  });

  it("runs Run with the shared selector prop (own editable pill)", () => {
    const p = props({ primaryAction: "run", selector: "orders+" });
    render(<SqlMeshToolbar {...p} />);
    // Run carries the same editable selector pill as Plan.
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    expect(screen.getByTestId("sqlmesh-splitbutton-scope-run").getAttribute("value")).toBe("orders+");
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-primary"));
    expect(p.handleSmRun).toHaveBeenCalledWith("orders+");
  });

  it("runs Lint and Audit from the dropdown", () => {
    const p = props();
    render(<SqlMeshToolbar {...p} />);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-item-lint"));
    expect(p.handleSmLint).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-item-audit"));
    expect(p.handleSmAudit).toHaveBeenCalledTimes(1);
  });

  it("runs Test from the dropdown and promotes the picked action", () => {
    const p = props();
    render(<SqlMeshToolbar {...p} />);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-item-test"));
    expect(p.handleSmTest).toHaveBeenCalledTimes(1);
    expect(p.onSelectAction).toHaveBeenCalledWith("test");
  });

  it("collapses the rendered pane when Render is already active", () => {
    const p = props({ showRendered: true });
    render(<SqlMeshToolbar {...p} />);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-item-render"));
    expect(p.setShowRendered).toHaveBeenCalledWith(false);
    expect(p.handleSmRender).not.toHaveBeenCalled();
  });

  it("toggles lineage from the dropdown", () => {
    const p = props();
    render(<SqlMeshToolbar {...p} />);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-item-lineage"));
    expect(p.setShowLineage).toHaveBeenCalledTimes(1);
  });

  it("disables Plan and Test while a command is running", () => {
    render(<SqlMeshToolbar {...props({ smRunningCommand: { type: "plan" } })} />);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    expect(screen.getByTestId("sqlmesh-splitbutton-item-plan").className).toContain("disabled");
    expect(screen.getByTestId("sqlmesh-splitbutton-item-test").className).toContain("disabled");
  });

  it("disables Preview for Python models", () => {
    const p = props({ isSqlMeshPythonModel: true });
    render(<SqlMeshToolbar {...p} />);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    expect(screen.getByTestId("sqlmesh-splitbutton-item-preview").className).toContain("disabled");
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-item-preview"));
    expect(p.handleSmPreview).not.toHaveBeenCalled();
  });
});
