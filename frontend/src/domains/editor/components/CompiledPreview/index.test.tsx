import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompiledPreview } from "./index";
import { useSettingsStore } from "@shared/settings";
import { mountEditor } from "@domains/editor/utils/ui/setup";

// Mock Icon to avoid useSettingsStore dependency
vi.mock("@shared/ui/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

// Mock mountEditor: CodeMirror 6 doesn't render in jsdom
vi.mock("@domains/editor/utils/ui/setup", () => ({
  mountEditor: vi.fn(() => () => {}),
}));

const noop = () => {};

describe("CompiledPreview", () => {
  it("renders without error and host div exists when compiledSql provided", () => {
    const { container } = render(
      <CompiledPreview
        compiledSql="SELECT 1"
        isStale={false}
        isLoading={false}
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    expect(container.querySelector("[data-testid='compiled-sql-host']")).toBeTruthy();
  });

  it("keeps the editor host mounted (not the spinner) while recompiling with existing SQL", () => {
    const { container } = render(
      <CompiledPreview
        compiledSql="SELECT 1"
        isStale={false}
        isLoading={true}
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    // Host stays mounted so CodeMirror is never torn down between recompiles…
    expect(container.querySelector("[data-testid='compiled-sql-host']")).toBeTruthy();
    // …and the body-level spinner does not replace it.
    expect(container.querySelector("[data-testid='compiled-loading-spinner']")).toBeNull();
  });

  it("shows stale indicator when isStale=true and not loading", () => {
    render(
      <CompiledPreview
        compiledSql=""
        isStale={true}
        isLoading={false}
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    expect(screen.getByTestId("stale-chip").textContent).toContain("Stale");
  });

  it("shows loading state when isLoading=true", () => {
    render(
      <CompiledPreview
        compiledSql=""
        isStale={false}
        isLoading={true}
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    // Loading chip in toolbar
    expect(screen.getByTestId("loading-chip").textContent).toContain("Compiling");
  });

  it("shows empty state when no sql and not loading", () => {
    render(
      <CompiledPreview
        compiledSql=""
        isStale={false}
        isLoading={false}
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    const matches = screen.getAllByText(/Compile/i);
    const hasEmptyState = matches.some((el) =>
      el.textContent?.includes("Click Compile to preview rendered SQL."),
    );
    expect(hasEmptyState).toBe(true);
  });

  it("shows the command-logs pointer when hasError and not loading", () => {
    render(
      <CompiledPreview
        compiledSql=""
        isStale={false}
        isLoading={false}
        hasError
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    expect(screen.getByTestId("compiled-error").textContent).toContain("command logs");
  });

  it("shows the spinning database icon while compiling, suppressing the error message", () => {
    render(
      <CompiledPreview
        compiledSql=""
        isStale={false}
        isLoading
        hasError
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    expect(screen.getByTestId("compiled-loading-spinner")).toBeTruthy();
    expect(screen.queryByTestId("compiled-error")).toBeNull();
  });

  it("passes editorFontSize from preferences to mountEditor", () => {
    useSettingsStore.setState({ editorFontSize: 20 });
    render(
      <CompiledPreview
        compiledSql="SELECT 1"
        isStale={false}
        isLoading={false}
        onRefresh={noop}
        onCollapse={noop}
      />,
    );
    expect(vi.mocked(mountEditor)).toHaveBeenCalledWith(
      expect.objectContaining({ fontSize: 20 }),
    );
  });

  it("calls onCollapse when close button is clicked", () => {
    const onCollapse = vi.fn();
    render(
      <CompiledPreview
        compiledSql="SELECT 1"
        isStale={false}
        isLoading={false}
        onRefresh={noop}
        onCollapse={onCollapse}
      />,
    );
    screen.getByTestId("compiled-collapse-button").click();
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
