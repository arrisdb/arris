import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@shell/components/RightSidebar", () => ({ RightSidebar: () => <div data-testid="right-sidebar" /> }));
vi.mock("@domains/editor", () => ({ EditorPane: () => <div data-testid="query-editor" /> }));
vi.mock("@domains/results/components/ResultsTableView", () => ({
  ResultsTableView: () => <div data-testid="results-table" />,
  ResultsFooterBar: () => <div data-testid="results-footer" />,
}));
vi.mock("@shell/components/StatusBar", () => ({ StatusBar: () => <div data-testid="status-bar" /> }));
vi.mock("@shell/components/LeftSidebar", () => ({ LeftSidebar: () => <div data-testid="left-sidebar" /> }));
vi.mock("@domains/settings", () => ({ SettingsView: () => null }));
vi.mock("@shell/components/TopBar", () => ({ TopBar: () => <div data-testid="top-bar" /> }));
vi.mock("@shared/ui/utils/editorFont", () => ({
  applyEditorFontFamily: vi.fn(),
}));
vi.mock("@shared/ui/utils/uiFont", () => ({
  applyUiFontFamily: vi.fn(),
}));

import { ContentView } from ".";
import { useSettingsStore } from "@shared/settings";
import { useTabsStore } from "../../hooks/tabsStore";
import { applyEditorFontFamily } from "@shared/ui/utils/editorFont";
import { applyUiFontFamily } from "@shared/ui/utils/uiFont";

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({
    sidebarLeftVisible: true,
    sidebarRightVisible: true,
    sidebarLeftTab: "files",
    uiFontSize: 13,
    editorFontFamily: null,
    uiFontFamily: null,
  });
  useTabsStore.setState({ tabs: [], activeId: null, layout: null, focusedPaneGroupId: null });
});

function panelIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-panel-id]"))
    .map((el) => el.getAttribute("data-panel-id")!)
    .filter(Boolean);
}

function panelGroupIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-panel-group-id]"))
    .map((el) => el.getAttribute("data-panel-group-id")!)
    .filter(Boolean);
}

function seedConsolePane() {
  useTabsStore.setState({
    tabs: [{ id: "t1", title: "Q", text: "select 1", kind: "sql", cursor: 0, tabType: "console" } as any],
    activeId: "t1",
    layout: { kind: "leaf", id: "g1", tabIds: ["t1"], selectedTabId: "t1" },
    focusedPaneGroupId: "g1",
  });
}

describe("ContentView panel identity", () => {
  it("applies editor font preference from the ContentView hook", () => {
    useSettingsStore.setState({ editorFontFamily: "JetBrains Mono" });

    render(<ContentView />);

    expect(applyEditorFontFamily).toHaveBeenCalledWith("JetBrains Mono");
  });

  it("applies UI font preference from the ContentView hook", () => {
    useSettingsStore.setState({ uiFontFamily: "Inter" });

    render(<ContentView />);

    expect(applyUiFontFamily).toHaveBeenCalledWith("Inter");
  });

  it("renders the top bar above the main panels", () => {
    const { container } = render(<ContentView />);
    expect(container.querySelector(".mdbc-window > [data-testid='top-bar']")).toBeTruthy();
  });

  it("renders all three panels with stable IDs when both sidebars visible", () => {
    const { container } = render(<ContentView />);
    const ids = panelIds(container);
    expect(ids).toContain("left-sidebar");
    expect(ids).toContain("center-editor");
    expect(ids).toContain("right-sidebar");
  });

  it("renders PanelGroup with stable id", () => {
    const { container } = render(<ContentView />);
    const groupIds = panelGroupIds(container);
    expect(groupIds).toContain("main-horizontal");
  });

  it("keeps center-editor ID stable when left sidebar hidden", () => {
    useSettingsStore.setState({ sidebarLeftVisible: false });
    const { container } = render(<ContentView />);
    const ids = panelIds(container);
    expect(ids).not.toContain("left-sidebar");
    expect(ids).toContain("center-editor");
    expect(ids).toContain("right-sidebar");
  });

  it("keeps center-editor ID stable when right sidebar hidden", () => {
    useSettingsStore.setState({ sidebarRightVisible: false });
    const { container } = render(<ContentView />);
    const ids = panelIds(container);
    expect(ids).toContain("left-sidebar");
    expect(ids).toContain("center-editor");
    expect(ids).not.toContain("right-sidebar");
  });

  it("renders only center-editor when both sidebars hidden", () => {
    useSettingsStore.setState({ sidebarLeftVisible: false, sidebarRightVisible: false });
    const { container } = render(<ContentView />);
    const ids = panelIds(container);
    expect(ids).not.toContain("left-sidebar");
    expect(ids).not.toContain("right-sidebar");
    expect(ids).toContain("center-editor");
  });

  it("shows results-panel when bottomPaneVisible is true and tab exists", () => {
    useSettingsStore.setState({ bottomPaneVisible: true });
    useTabsStore.setState({
      tabs: [{ id: "t1", title: "Q", text: "select 1", kind: "sql", cursor: 0, tabType: "console" } as any],
      activeId: "t1",
      layout: { kind: "leaf", id: "g1", tabIds: ["t1"], selectedTabId: "t1" },
      focusedPaneGroupId: "g1",
    });
    const { container } = render(<ContentView />);
    const ids = panelIds(container);
    expect(ids).toContain("results-panel");
    expect(ids).toContain("editor-panel");
  });

  it("hides results-panel when bottomPaneVisible is false", () => {
    useSettingsStore.setState({ bottomPaneVisible: false });
    useTabsStore.setState({
      tabs: [{ id: "t1", title: "Q", text: "select 1", kind: "sql", cursor: 0, tabType: "console" } as any],
      activeId: "t1",
      layout: { kind: "leaf", id: "g1", tabIds: ["t1"], selectedTabId: "t1" },
      focusedPaneGroupId: "g1",
    });
    const { container } = render(<ContentView />);
    const ids = panelIds(container);
    expect(ids).not.toContain("results-panel");
  });

  it("renders table tabs in the normal pane layout (results live inside the pane)", () => {
    useSettingsStore.setState({ bottomPaneVisible: false });
    useTabsStore.setState({
      tabs: [{ id: "t1", title: "users", text: "", kind: "sql", cursor: 0, tabType: "table" } as any],
      activeId: "t1",
      layout: { kind: "leaf", id: "g1", tabIds: ["t1"], selectedTabId: "t1" },
      focusedPaneGroupId: "g1",
    });
    const { container } = render(<ContentView />);
    // Table tabs render their results inside their own pane (TableTabView), so
    // ContentView uses the normal editor layout with no stacked table-mode div
    // and no shared bottom results panel when the bottom pane is hidden.
    const ids = panelIds(container);
    expect(ids).toContain("editor-panel");
    expect(ids).not.toContain("results-panel");
    expect(container.querySelector(".mdbc-content-editor-results.table-mode")).toBeNull();
    expect(container.querySelector("[data-testid='query-editor']")).toBeTruthy();
  });

  it("shares space with a table tab when the bottom pane is on (global pane, no mirror)", () => {
    // The global bottom pane is shown for every tab type per the visibility
    // toggle. It never duplicates a table tab's grid because it follows the
    // globally-selected run (table-tab runs are excluded from that selection in
    // RunHistoryChips/utils), not the active tab, so a table tab simply shares
    // vertical space with whatever the pane was already showing. Opening the
    // table tab does not itself open the pane; the toggle was already on here.
    useSettingsStore.setState({ bottomPaneVisible: true });
    useTabsStore.setState({
      tabs: [{ id: "t1", title: "users", text: "", kind: "sql", cursor: 0, tabType: "table" } as any],
      activeId: "t1",
      layout: { kind: "leaf", id: "g1", tabIds: ["t1"], selectedTabId: "t1" },
      focusedPaneGroupId: "g1",
    });
    const { container } = render(<ContentView />);
    const ids = panelIds(container);
    expect(ids).toContain("editor-panel");
    expect(ids).toContain("results-panel");
    expect(container.querySelector("[data-testid='results-footer']")).toBeTruthy();
  });

  it.each(["terminal", "gitdiff", "githistory", "gitconflict"] as const)(
    "keeps the global Command Logs/Results pane on full-pane %s tabs",
    (tabType) => {
      useSettingsStore.setState({ bottomPaneVisible: true });
      useTabsStore.setState({
        tabs: [{ id: "t1", title: "x", text: "", kind: "sql", cursor: 0, tabType } as any],
        activeId: "t1",
        layout: { kind: "leaf", id: "g1", tabIds: ["t1"], selectedTabId: "t1" },
        focusedPaneGroupId: "g1",
      });
      const { container } = render(<ContentView />);
      expect(panelIds(container)).toContain("results-panel");
      expect(container.querySelector("[data-testid='results-footer']")).toBeTruthy();
    },
  );

  it("keeps the global pane available with no tabs open", () => {
    // After a dbt/sqlmesh command with no SQL tab, Command Logs must still be
    // reachable: the pane is global, not tied to an open editor tab.
    useSettingsStore.setState({ bottomPaneVisible: true });
    useTabsStore.setState({ tabs: [], activeId: null, layout: null, focusedPaneGroupId: null });
    const { container } = render(<ContentView />);
    expect(panelIds(container)).toContain("results-panel");
    expect(container.querySelector("[data-testid='results-footer']")).toBeTruthy();
  });

  it("keeps the resizable editor/results split for console tabs", () => {
    useSettingsStore.setState({ bottomPaneVisible: true });
    seedConsolePane();
    const { container } = render(<ContentView />);
    const ids = panelIds(container);
    expect(ids).toContain("editor-panel");
    expect(ids).toContain("results-panel");
    expect(container.querySelector(".mdbc-content-editor-results.table-mode")).toBeNull();
  });

  it("renders results-footer when bottomPaneVisible is false (no results-table)", () => {
    useSettingsStore.setState({ bottomPaneVisible: false });
    seedConsolePane();
    const { container } = render(<ContentView />);
    expect(container.querySelector("[data-testid='results-footer']")).toBeTruthy();
    expect(container.querySelector("[data-testid='results-table']")).toBeNull();
  });

  it("always renders results-footer regardless of bottomPaneVisible", () => {
    useSettingsStore.setState({ bottomPaneVisible: true });
    seedConsolePane();
    const { container: c1 } = render(<ContentView />);
    expect(c1.querySelector("[data-testid='results-footer']")).toBeTruthy();

    useSettingsStore.setState({ bottomPaneVisible: false });
    seedConsolePane();
    const { container: c2 } = render(<ContentView />);
    expect(c2.querySelector("[data-testid='results-footer']")).toBeTruthy();
  });
});
