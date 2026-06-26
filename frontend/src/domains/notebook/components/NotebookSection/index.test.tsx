import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { NotebookSection } from "./index";
import { useTabsStore } from "@shell/hooks/tabsStore";

beforeEach(() => {
  vi.useFakeTimers();
  useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
  window.localStorage.removeItem("leftSidebar.notebookTabs.collapsed");
  window.localStorage.removeItem("leftSidebar.sectionHeight");
});
afterEach(() => {
  vi.useRealTimers();
});

function addTab(
  id: string,
  title: string,
  tabType: string,
  createdAt = 1,
  filePath?: string,
) {
  useTabsStore.setState((s) => ({
    tabs: [
      ...s.tabs,
      { id, title, text: "", kind: "notebook", cursor: 0, tabType, createdAt, filePath } as never,
    ],
  }));
}

describe("NotebookSection", () => {
  it("renders only notebook tabs", () => {
    addTab("n1", "Notebook 1", "notebook");
    addTab("c1", "SQL Console", "console");
    render(<NotebookSection />);
    expect(screen.getByTestId("notebook-section")).toBeTruthy();
    expect(screen.getByText("Notebook 1")).toBeTruthy();
    expect(screen.queryByText("SQL Console")).toBeNull();
  });

  it("renders nothing when there are no notebooks", () => {
    addTab("c1", "SQL Console", "console");
    const { container } = render(<NotebookSection />);
    expect(container.firstChild).toBeNull();
  });

  it("lists only untitled scratch notebooks, not file-backed ones", () => {
    addTab("scratch", "Notebook 1", "notebook");
    addTab("file", "analysis.ipynb", "notebook", 2, "/project/analysis.ipynb");
    render(<NotebookSection />);
    expect(screen.getByText("Notebook 1")).toBeTruthy();
    // A notebook opened from the file explorer has a filePath, keep it out.
    expect(screen.queryByText("analysis.ipynb")).toBeNull();
  });

  it("renders nothing when the only notebook is file-backed", () => {
    addTab("file", "analysis.ipynb", "notebook", 1, "/project/analysis.ipynb");
    const { container } = render(<NotebookSection />);
    expect(container.firstChild).toBeNull();
  });

  it("clicking a row focuses the tab", () => {
    addTab("n1", "Notebook 1", "notebook");
    render(<NotebookSection />);
    fireEvent.click(screen.getByTestId("notebook-section-row-n1"));
    expect(useTabsStore.getState().activeId).toBe("n1");
  });

  it("row context menu offers Move to Project", () => {
    addTab("n1", "Notebook 1", "notebook");
    render(<NotebookSection />);
    fireEvent.contextMenu(screen.getByTestId("notebook-section-row-n1"));
    const menu = screen.getByTestId("notebook-section-ctx-menu");
    expect(within(menu).getByText("Move to Project")).toBeTruthy();
  });

  it("New Jupyter Notebook context item opens an untitled notebook tab", () => {
    addTab("n1", "Notebook 1", "notebook");
    render(<NotebookSection />);
    fireEvent.contextMenu(screen.getByTestId("notebook-section-list"));
    fireEvent.click(
      within(screen.getByTestId("notebook-section-ctx-menu")).getByText("New Jupyter Notebook"),
    );
    const notebookTabs = useTabsStore
      .getState()
      .tabs.filter((t) => t.tabType === "notebook");
    expect(notebookTabs).toHaveLength(2);
    // The new one is an in-memory notebook (no file backing).
    const fresh = notebookTabs.find((t) => t.id !== "n1");
    expect(fresh?.filePath).toBeUndefined();
    expect(fresh?.title).toMatch(/^Notebook \d+$/);
  });
});
