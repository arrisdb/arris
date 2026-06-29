import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CanvasSection } from "./index";
import { useTabsStore } from "@shell/hooks/tabsStore";

beforeEach(() => {
  vi.useFakeTimers();
  useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
  window.localStorage.removeItem("leftSidebar.canvasTabs.collapsed");
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
      { id, title, text: "", kind: "canvas", cursor: 0, tabType, createdAt, filePath } as never,
    ],
  }));
}

describe("CanvasSection", () => {
  it("renders only canvas tabs", () => {
    addTab("k1", "Canvas 1", "canvas");
    addTab("c1", "SQL Console", "console");
    render(<CanvasSection />);
    expect(screen.getByTestId("canvas-section")).toBeTruthy();
    expect(screen.getByText("Canvas 1")).toBeTruthy();
    expect(screen.queryByText("SQL Console")).toBeNull();
  });

  it("renders nothing when there are no canvases", () => {
    addTab("c1", "SQL Console", "console");
    const { container } = render(<CanvasSection />);
    expect(container.firstChild).toBeNull();
  });

  it("lists only untitled scratch canvases, not file-backed ones", () => {
    addTab("scratch", "Canvas 1", "canvas");
    addTab("file", "board.canvas.json", "canvas", 2, "/project/board.canvas.json");
    render(<CanvasSection />);
    expect(screen.getByText("Canvas 1")).toBeTruthy();
    expect(screen.queryByText("board.canvas.json")).toBeNull();
  });

  it("clicking a row focuses the tab", () => {
    addTab("k1", "Canvas 1", "canvas");
    render(<CanvasSection />);
    fireEvent.click(screen.getByTestId("canvas-section-row-k1"));
    expect(useTabsStore.getState().activeId).toBe("k1");
  });

  it("row context menu offers Move to Project", () => {
    addTab("k1", "Canvas 1", "canvas");
    render(<CanvasSection />);
    fireEvent.contextMenu(screen.getByTestId("canvas-section-row-k1"));
    const menu = screen.getByTestId("canvas-section-ctx-menu");
    expect(within(menu).getByText("Move to Project")).toBeTruthy();
  });

  it("New Canvas context item opens an untitled canvas tab", () => {
    addTab("k1", "Canvas 1", "canvas");
    render(<CanvasSection />);
    fireEvent.contextMenu(screen.getByTestId("canvas-section-list"));
    fireEvent.click(
      within(screen.getByTestId("canvas-section-ctx-menu")).getByText("New Canvas"),
    );
    const canvasTabs = useTabsStore
      .getState()
      .tabs.filter((t) => t.tabType === "canvas");
    expect(canvasTabs).toHaveLength(2);
    const fresh = canvasTabs.find((t) => t.id !== "k1");
    expect(fresh?.filePath).toBeUndefined();
    expect(fresh?.title).toMatch(/^Canvas \d+$/);
  });
});
