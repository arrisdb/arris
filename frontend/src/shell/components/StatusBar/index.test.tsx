import { useConnectionsStore } from "@domains/connection/hooks";
import { useResultsTableStore } from "@domains/results/hooks";
import { usePinnedQueriesStore } from "@domains/pinnedQueries/hooks";
import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { StatusBar } from ".";
import { useGlobalCommands } from "@shell/utils";
import { useSettingsStore } from "@shared/settings";
import { useGitStore } from "@domains/git/hooks";
import { useChartEditorStore } from "@domains/chart/hooks";
import { useTabsStore } from "../../hooks/tabsStore";
import { useBackgroundTasksStore } from "../../hooks/backgroundTasksStore";

// The status-bar buttons invoke pane toggles through the command registry, so
// the tests mount the global command handlers alongside the bar, mirroring how
// App wires them in production. Without this, runCommand would be a no-op.
function StatusBarHarness() {
  useGlobalCommands();
  return <StatusBar />;
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().reset();
  useSettingsStore.setState({ isOpen: false, activePane: "appearance" });
  useGitStore.setState({ isPickerOpen: false, currentBranch: "main" });
  useConnectionsStore.setState({ connections: [], selectedId: null });
  useSettingsStore.setState({
    sidebarLeftTab: "files",
    sidebarLeftVisible: true,
    sidebarRightVisible: true,
  });
  useChartEditorStore.setState({ targetTabId: null });
  useResultsTableStore.setState({ modeByTab: {}, globalMode: "results" });
  usePinnedQueriesStore.setState({ queries: [], paneOpen: false });
  useTabsStore.setState({ tabs: [], activeId: null, layout: null, focusedPaneGroupId: null });
  useBackgroundTasksStore.setState({ tasks: new Map() });
});

describe("StatusBar", () => {
  it("prevents native context menu on the bottom bar", () => {
    render(<StatusBarHarness />);

    const surface = document.querySelector(".mdbc-status")!;
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      surface.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });

  it("does not render a Settings opener (Settings now lives in the OS menu)", () => {
    render(<StatusBarHarness />);
    expect(screen.queryByRole("button", { name: /settings/i })).toBeNull();
  });

  it("does not render the connection state, MCP, branch, or UTF-8 indicators (chrome lives elsewhere)", () => {
    render(<StatusBarHarness />);
    expect(screen.queryByText(/no connection/i)).toBeNull();
    expect(screen.queryByText(/mcp/i)).toBeNull();
    expect(screen.queryByText(/UTF-8/)).toBeNull();
    expect(screen.queryByRole("button", { name: /git branch/i })).toBeNull();
  });

  it("renders the Files / Git pane rail", () => {
    render(<StatusBarHarness />);
    expect(screen.getByTestId("status-rail-files")).toBeTruthy();
    expect(screen.getByTestId("status-rail-git")).toBeTruthy();
  });

  it("renders the Connections button on the right rail", () => {
    render(<StatusBarHarness />);
    expect(screen.getByTestId("status-rail-connections")).toBeTruthy();
    expect(screen.getByTestId("status-rail-connections").getAttribute("aria-label")).toBe("Connections");
  });

  it("clicking a different rail icon switches the sidebar pane and keeps it visible", () => {
    render(<StatusBarHarness />);
    fireEvent.click(screen.getByTestId("status-rail-git"));
    const s = useSettingsStore.getState();
    expect(s.sidebarLeftTab).toBe("git");
    expect(s.sidebarLeftVisible).toBe(true);
  });

  it("clicking the Git rail opens the Uncommitted Changes tab", () => {
    render(<StatusBarHarness />);
    fireEvent.click(screen.getByTestId("status-rail-git"));
    const tabs = useTabsStore.getState().tabs;
    expect(tabs.filter((t) => t.tabType === "gitdiff")).toHaveLength(1);
    expect(useTabsStore.getState().activeId).toBe(tabs.find((t) => t.tabType === "gitdiff")!.id);
  });

  it("does not open a second Uncommitted Changes tab when toggling the Git rail off", () => {
    useSettingsStore.setState({ sidebarLeftTab: "git", sidebarLeftVisible: true });
    const existing = useTabsStore.getState().openGitDiffTab();
    render(<StatusBarHarness />);
    // Clicking the already-active Git rail hides the sidebar; must not reopen.
    fireEvent.click(screen.getByTestId("status-rail-git"));
    expect(useSettingsStore.getState().sidebarLeftVisible).toBe(false);
    expect(useTabsStore.getState().tabs.filter((t) => t.tabType === "gitdiff")).toHaveLength(1);
    expect(useTabsStore.getState().tabs[0].id).toBe(existing.id);
  });

  it("clicking the active rail icon hides the left sidebar", () => {
    useSettingsStore.setState({ sidebarLeftTab: "files", sidebarLeftVisible: true });
    render(<StatusBarHarness />);
    fireEvent.click(screen.getByTestId("status-rail-files"));
    expect(useSettingsStore.getState().sidebarLeftVisible).toBe(false);
  });

  it("clicking a rail icon when sidebar is collapsed re-shows it", () => {
    useSettingsStore.setState({ sidebarLeftTab: "files", sidebarLeftVisible: false });
    render(<StatusBarHarness />);
    fireEvent.click(screen.getByTestId("status-rail-git"));
    const s = useSettingsStore.getState();
    expect(s.sidebarLeftTab).toBe("git");
    expect(s.sidebarLeftVisible).toBe(true);
  });

  it("clicking connection button toggles right sidebar", () => {
    render(<StatusBarHarness />);
    expect(useSettingsStore.getState().sidebarRightVisible).toBe(true);
    fireEvent.click(screen.getByTestId("status-rail-connections"));
    expect(useSettingsStore.getState().sidebarRightVisible).toBe(false);
    fireEvent.click(screen.getByTestId("status-rail-connections"));
    expect(useSettingsStore.getState().sidebarRightVisible).toBe(true);
  });

  it("marks the active rail tab via aria-selected only when visible", () => {
    useSettingsStore.setState({ sidebarLeftTab: "git", sidebarLeftVisible: true });
    render(<StatusBarHarness />);
    expect(screen.getByTestId("status-rail-git").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("status-rail-files").getAttribute("aria-selected")).toBe("false");
  });

  it("no rail tab shows aria-selected when sidebar is collapsed", () => {
    useSettingsStore.setState({ sidebarLeftTab: "git", sidebarLeftVisible: false });
    render(<StatusBarHarness />);
    expect(screen.getByTestId("status-rail-git").getAttribute("aria-selected")).toBe("false");
  });

  it("does not mark connections active while pinned queries is active", () => {
    useSettingsStore.setState({ sidebarRightVisible: true });
    usePinnedQueriesStore.setState({ paneOpen: true });
    render(<StatusBarHarness />);
    const pinned = screen.getByTestId("status-rail-pinned-queries");
    const connections = screen.getByTestId("status-rail-connections");

    expect(pinned.getAttribute("aria-selected")).toBe("true");
    expect(pinned.className).toContain("on");
    expect(connections.getAttribute("aria-selected")).toBe("false");
    expect(connections.className).not.toContain("on");
  });

  it("clicking pinned queries makes only pinned queries active on the right rail", () => {
    useSettingsStore.setState({ sidebarRightVisible: true });
    render(<StatusBarHarness />);
    fireEvent.click(screen.getByTestId("status-rail-pinned-queries"));

    expect(screen.getByTestId("status-rail-pinned-queries").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("status-rail-connections").getAttribute("aria-selected")).toBe("false");

    fireEvent.click(screen.getByTestId("status-rail-connections"));
    expect(useSettingsStore.getState().sidebarRightVisible).toBe(true);
    expect(usePinnedQueriesStore.getState().paneOpen).toBe(false);
    expect(screen.getByTestId("status-rail-pinned-queries").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("status-rail-connections").getAttribute("aria-selected")).toBe("true");
  });

  it("renders tooltip with label and shortcut for each rail button", () => {
    render(<StatusBarHarness />);
    expect(screen.getByText("Project")).toBeTruthy();
    expect(screen.getByText("⌘1")).toBeTruthy();
    expect(screen.getByText("Git")).toBeTruthy();
    expect(screen.getByText("⌘2")).toBeTruthy();
    expect(screen.getByText("Pinned Queries")).toBeTruthy();
    expect(screen.getByText("⌘9")).toBeTruthy();
    expect(screen.getByText("Connections")).toBeTruthy();
    expect(screen.getByText("⌘0")).toBeTruthy();
  });

  describe("chart editor button", () => {
    // The chart editor edits the chart of a result already shown as a chart, so
    // the button only enables when the active tab's results pane is in Chart
    // view (or the editor is already open). Otherwise it stays visible but
    // disabled.
    function consoleTab(id: string) {
      useTabsStore.setState({
        tabs: [{ id, title: "Console 1", text: "", kind: "sql", cursor: 0, tabType: "console" }],
        activeId: id,
      } as any);
    }

    it("chart editor button is visible but disabled on a terminal tab", () => {
      useTabsStore.setState({
        tabs: [{ id: "t1", title: "Terminal 1", text: "", kind: "terminal", cursor: 0, tabType: "terminal" }],
        activeId: "t1",
      } as any);
      render(<StatusBarHarness />);
      const btn = screen.getByTestId("status-rail-chart-editor");
      expect(btn.hasAttribute("disabled")).toBe(true);
    });

    it("chart editor button is disabled on a query tab not in chart view", () => {
      consoleTab("q1");
      render(<StatusBarHarness />);
      expect(screen.getByTestId("status-rail-chart-editor").hasAttribute("disabled")).toBe(true);
    });

    it("chart editor button is enabled on a query tab in chart view", () => {
      consoleTab("q1");
      useResultsTableStore.setState({ modeByTab: { q1: "chart" } });
      render(<StatusBarHarness />);
      expect(screen.getByTestId("status-rail-chart-editor").hasAttribute("disabled")).toBe(false);
    });

    it("clicking chart editor button opens chart editor for the active tab in chart view", () => {
      consoleTab("q1");
      useResultsTableStore.setState({ modeByTab: { q1: "chart" } });
      render(<StatusBarHarness />);
      fireEvent.click(screen.getByTestId("status-rail-chart-editor"));
      expect(useChartEditorStore.getState().targetTabId).toBe("q1");
    });

    it("clicking chart editor button again closes it (button stays enabled while open)", () => {
      consoleTab("q1");
      useResultsTableStore.setState({ modeByTab: { q1: "chart" } });
      useChartEditorStore.setState({ targetTabId: "q1" });
      render(<StatusBarHarness />);
      fireEvent.click(screen.getByTestId("status-rail-chart-editor"));
      expect(useChartEditorStore.getState().targetTabId).toBeNull();
    });

    it("chart editor button shows on state when editor is open", () => {
      consoleTab("q1");
      useChartEditorStore.setState({ targetTabId: "q1" });
      render(<StatusBarHarness />);
      expect(screen.getByTestId("status-rail-chart-editor").className).toContain("on");
    });

    it("clicking chart editor button closes pinned queries so only one right rail pane is active", () => {
      consoleTab("q1");
      useResultsTableStore.setState({ modeByTab: { q1: "chart" } });
      usePinnedQueriesStore.setState({ paneOpen: true });

      render(<StatusBarHarness />);
      fireEvent.click(screen.getByTestId("status-rail-chart-editor"));

      expect(usePinnedQueriesStore.getState().paneOpen).toBe(false);
      expect(screen.getByTestId("status-rail-chart-editor").getAttribute("aria-selected")).toBe("true");
      expect(screen.getByTestId("status-rail-pinned-queries").getAttribute("aria-selected")).toBe("false");
      expect(screen.getByTestId("status-rail-connections").getAttribute("aria-selected")).toBe("false");
    });
  });

  describe("connections button closes chart editor", () => {
    it("clicking connections button when chart editor is open closes chart editor and toggles sidebar", () => {
      useTabsStore.setState({
        tabs: [{ id: "q1", title: "Console 1", text: "", kind: "sql", cursor: 0, tabType: "console" }],
        activeId: "q1",
      } as any);
      useChartEditorStore.setState({ targetTabId: "q1" });
      useSettingsStore.setState({ sidebarRightVisible: true });
      render(<StatusBarHarness />);
      fireEvent.click(screen.getByTestId("status-rail-connections"));
      expect(useChartEditorStore.getState().targetTabId).toBeNull();
    });

    it("clicking connections button without chart editor still toggles sidebar", () => {
      useChartEditorStore.setState({ targetTabId: null });
      useSettingsStore.setState({ sidebarRightVisible: true });
      render(<StatusBarHarness />);
      fireEvent.click(screen.getByTestId("status-rail-connections"));
      expect(useSettingsStore.getState().sidebarRightVisible).toBe(false);
      fireEvent.click(screen.getByTestId("status-rail-connections"));
      expect(useSettingsStore.getState().sidebarRightVisible).toBe(true);
    });
  });


  it("does not show activity indicator when no background tasks", () => {
    render(<StatusBarHarness />);
    expect(screen.queryByTestId("status-activity")).toBeNull();
  });

  it("shows activity indicator with label when a background task is active", () => {
    const tasks = new Map<string, string>();
    tasks.set("dbt-load", "Loading dbt project…");
    useBackgroundTasksStore.setState({ tasks });
    render(<StatusBarHarness />);
    expect(screen.getByTestId("status-activity")).toBeTruthy();
    expect(screen.getByText("Loading dbt project…")).toBeTruthy();
  });

  it("hides activity indicator when task ends", () => {
    const tasks = new Map<string, string>();
    tasks.set("test-task", "Testing…");
    useBackgroundTasksStore.setState({ tasks });
    const { rerender } = render(<StatusBarHarness />);
    expect(screen.getByTestId("status-activity")).toBeTruthy();
    act(() => {
      useBackgroundTasksStore.setState({ tasks: new Map() });
    });
    rerender(<StatusBarHarness />);
    expect(screen.queryByTestId("status-activity")).toBeNull();
  });
});
