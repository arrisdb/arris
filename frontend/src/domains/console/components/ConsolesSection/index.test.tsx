import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ConsolesSection } from "./index";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { leavesOf } from "@shell/utils/paneTree";

beforeEach(() => {
  vi.useFakeTimers();
  useTabsStore.setState({ tabs: [], activeId: null });
  window.localStorage.removeItem("leftSidebar.consoleTabs.collapsed");
  window.localStorage.removeItem("leftSidebar.sectionHeight");
});
afterEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function addConsoleTab(id: string, title: string, createdAt = 1) {
  useTabsStore.setState((s) => ({
    tabs: [
      ...s.tabs,
      { id, title, text: "", kind: "sql", cursor: 0, tabType: "console", createdAt } as never,
    ],
  }));
}

describe("ConsolesSection", () => {
  it("renders when tabs exist", () => {
    addConsoleTab("t1", "Console 1");
    render(<ConsolesSection />);
    expect(screen.getByTestId("consoles-section")).toBeTruthy();
  });

  it("labels the header 'SQL Consoles'", () => {
    addConsoleTab("t1", "Console 1");
    render(<ConsolesSection />);
    expect(screen.getByTestId("consoles-toggle").textContent).toContain("SQL Consoles");
  });

  it("does not render a count badge in the header", () => {
    addConsoleTab("t1", "Console 1");
    addConsoleTab("t2", "Console 2");
    render(<ConsolesSection />);
    const toggle = screen.getByTestId("consoles-toggle");
    expect(toggle.querySelector(".mdbc-consoles-count")).toBeNull();
  });

  it("is fixed-height with a resizer and a collapse toggle", () => {
    addConsoleTab("t1", "Console 1");
    render(<ConsolesSection />);
    const section = screen.getByTestId("consoles-section");
    expect(Array.from(section.style)).toContain("--mdbc-sidebar-section-height");
    expect(screen.getByTestId("consoles-resizer")).toBeTruthy();
    expect(screen.getByTestId("consoles-list")).toBeTruthy();
    fireEvent.click(screen.getByTestId("consoles-toggle"));
    expect(screen.queryByTestId("consoles-list")).toBeNull();
    expect(screen.queryByTestId("consoles-resizer")).toBeNull();
  });

  it("sorts most-recently-opened first", () => {
    addConsoleTab("old", "Old", 1000);
    addConsoleTab("new", "New", 2000);
    addConsoleTab("mid", "Mid", 1500);
    render(<ConsolesSection />);
    const list = screen.getByTestId("consoles-list");
    const rows = within(list).getAllByText(/^(Old|New|Mid)$/);
    expect(rows.map((r) => r.textContent)).toEqual(["New", "Mid", "Old"]);
  });

  it("double-click on a row opens an inline rename input", () => {
    addConsoleTab("t1", "Console 1");
    render(<ConsolesSection />);
    const row = screen.getByTestId("consoles-row-t1");
    fireEvent.doubleClick(row);
    const input = screen.getByTestId("consoles-rename-t1") as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "My report" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useTabsStore.getState().tabs[0].title).toBe("My report");
  });

  it("editor closeTab keeps the row in the list", () => {
    const t1 = useTabsStore.getState().addTab({ title: "Q1" });
    render(<ConsolesSection />);
    expect(screen.getByTestId(`consoles-row-${t1.id}`)).toBeTruthy();
    useTabsStore.getState().closeTab(t1.id);
    expect(leavesOf(useTabsStore.getState().layout)).toHaveLength(0);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(screen.getByTestId(`consoles-row-${t1.id}`)).toBeTruthy();
  });

  it("trash button soft-deletes and shows restore option", () => {
    addConsoleTab("t1", "Console 1");
    render(<ConsolesSection />);
    fireEvent.click(screen.getByTestId("consoles-delete-t1"));
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    const row = screen.getByTestId("consoles-row-t1");
    expect(row.classList.contains("soft-deleted")).toBe(true);
    expect(screen.getByTestId("consoles-restore-t1")).toBeTruthy();
  });

  it("restore button undoes soft-delete", () => {
    addConsoleTab("t1", "Console 1");
    render(<ConsolesSection />);
    fireEvent.click(screen.getByTestId("consoles-delete-t1"));
    fireEvent.click(screen.getByTestId("consoles-restore-t1"));
    const row = screen.getByTestId("consoles-row-t1");
    expect(row.classList.contains("soft-deleted")).toBe(false);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("soft-deleted tab is permanently removed after 30s", () => {
    addConsoleTab("t1", "Console 1");
    render(<ConsolesSection />);
    fireEvent.click(screen.getByTestId("consoles-delete-t1"));
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(useTabsStore.getState().tabs).toHaveLength(0);
  });

  it("collapsing section purges all soft-deleted tabs", () => {
    addConsoleTab("t1", "Console 1");
    addConsoleTab("t2", "Console 2");
    render(<ConsolesSection />);
    fireEvent.click(screen.getByTestId("consoles-delete-t1"));
    fireEvent.click(screen.getByTestId("consoles-toggle"));
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    expect(useTabsStore.getState().tabs[0].id).toBe("t2");
  });

  it("right-click on a row shows context menu with Rename, Move to Project and Delete", () => {
    addConsoleTab("t1", "Console 1");
    render(<ConsolesSection />);
    const row = screen.getByTestId("consoles-row-t1");
    fireEvent.contextMenu(row);
    const menu = screen.getByTestId("consoles-ctx-menu");
    expect(menu).toBeTruthy();
    expect(within(menu).getByText("Rename")).toBeTruthy();
    expect(within(menu).getByText("Move to Project")).toBeTruthy();
    expect(within(menu).getByText("Delete")).toBeTruthy();
  });

  it("excludes file-backed consoles (already moved to the project)", () => {
    addConsoleTab("t1", "Console 1");
    useTabsStore.setState((s) => ({
      tabs: [
        ...s.tabs,
        {
          id: "t2",
          title: "moved.sql",
          text: "",
          kind: "sql",
          cursor: 0,
          tabType: "console",
          filePath: "/proj/moved.sql",
          createdAt: 2,
        } as never,
      ],
    }));
    render(<ConsolesSection />);
    expect(screen.getByTestId("consoles-row-t1")).toBeTruthy();
    expect(screen.queryByTestId("consoles-row-t2")).toBeNull();
  });

  it("context menu Rename triggers inline rename", () => {
    addConsoleTab("t1", "Console 1");
    render(<ConsolesSection />);
    fireEvent.contextMenu(screen.getByTestId("consoles-row-t1"));
    fireEvent.click(within(screen.getByTestId("consoles-ctx-menu")).getByText("Rename"));
    expect(screen.getByTestId("consoles-rename-t1")).toBeTruthy();
  });

  it("context menu Delete soft-deletes the tab", () => {
    addConsoleTab("t1", "Console 1");
    render(<ConsolesSection />);
    fireEvent.contextMenu(screen.getByTestId("consoles-row-t1"));
    fireEvent.click(within(screen.getByTestId("consoles-ctx-menu")).getByText("Delete"));
    const row = screen.getByTestId("consoles-row-t1");
    expect(row.classList.contains("soft-deleted")).toBe(true);
    expect(useTabsStore.getState().tabs).toHaveLength(1);
  });

  it("right-click on empty space shows New Console option", () => {
    addConsoleTab("t1", "Console 1");
    render(<ConsolesSection />);
    const list = screen.getByTestId("consoles-list");
    fireEvent.contextMenu(list);
    const menu = screen.getByTestId("consoles-ctx-menu");
    expect(within(menu).getByText("New Console")).toBeTruthy();
  });

  it("New Console context menu item creates a new console tab", () => {
    addConsoleTab("t1", "Console 1");
    render(<ConsolesSection />);
    const list = screen.getByTestId("consoles-list");
    fireEvent.contextMenu(list);
    fireEvent.click(within(screen.getByTestId("consoles-ctx-menu")).getByText("New Console"));
    const consoleTabs = useTabsStore.getState().tabs.filter((t) => !t.tabType || t.tabType === "console");
    expect(consoleTabs).toHaveLength(2);
  });
});
