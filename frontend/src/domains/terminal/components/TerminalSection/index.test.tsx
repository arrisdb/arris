import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TerminalSection } from "./index";
import { useTabsStore } from "@shell/hooks/tabsStore";

beforeEach(() => {
  vi.useFakeTimers();
  useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
  window.localStorage.removeItem("leftSidebar.terminalTabs.collapsed");
  window.localStorage.removeItem("leftSidebar.sectionHeight");
});
afterEach(() => {
  vi.useRealTimers();
});

function addTab(id: string, title: string, tabType: string, createdAt = 1) {
  useTabsStore.setState((s) => ({
    tabs: [
      ...s.tabs,
      { id, title, text: "", kind: tabType, cursor: 0, tabType, createdAt } as never,
    ],
  }));
}

describe("TerminalSection", () => {
  it("renders only terminal tabs", () => {
    addTab("t1", "Terminal 1", "terminal");
    addTab("c1", "SQL Console", "console");
    render(<TerminalSection />);
    expect(screen.getByTestId("terminal-section")).toBeTruthy();
    expect(screen.getByText("Terminal 1")).toBeTruthy();
    expect(screen.queryByText("SQL Console")).toBeNull();
  });

  it("renders nothing when there are no terminals", () => {
    addTab("c1", "SQL Console", "console");
    const { container } = render(<TerminalSection />);
    expect(container.firstChild).toBeNull();
  });

  it("clicking a row focuses the tab", () => {
    addTab("t1", "Terminal 1", "terminal");
    render(<TerminalSection />);
    fireEvent.click(screen.getByTestId("terminal-section-row-t1"));
    expect(useTabsStore.getState().activeId).toBe("t1");
  });

  it("trash button closes the terminal (removed from tabs, live-only)", () => {
    addTab("t1", "Terminal 1", "terminal");
    addTab("t2", "Terminal 2", "terminal", 2);
    render(<TerminalSection />);
    fireEvent.click(screen.getByTestId("terminal-section-delete-t1"));
    const ids = useTabsStore.getState().tabs.map((t) => t.id);
    expect(ids).toEqual(["t2"]);
    // No soft-delete: the closed terminal leaves no restore row behind.
    expect(screen.queryByText("Terminal 1")).toBeNull();
  });

  it("row context menu offers Close, not Move to Project", () => {
    addTab("t1", "Terminal 1", "terminal");
    render(<TerminalSection />);
    fireEvent.contextMenu(screen.getByTestId("terminal-section-row-t1"));
    const menu = screen.getByTestId("terminal-section-ctx-menu");
    expect(within(menu).getByText("Close")).toBeTruthy();
    expect(within(menu).queryByText("Move to Project")).toBeNull();
  });

  it("New Terminal context item opens a terminal tab", () => {
    addTab("t1", "Terminal 1", "terminal");
    render(<TerminalSection />);
    fireEvent.contextMenu(screen.getByTestId("terminal-section-list"));
    fireEvent.click(
      within(screen.getByTestId("terminal-section-ctx-menu")).getByText("New Terminal"),
    );
    const terminalTabs = useTabsStore
      .getState()
      .tabs.filter((t) => t.tabType === "terminal");
    expect(terminalTabs).toHaveLength(2);
    const fresh = terminalTabs.find((t) => t.id !== "t1");
    expect(fresh?.title).toMatch(/^Terminal \d+$/);
  });
});
