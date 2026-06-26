import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@domains/connection/components/CombinedConnectionsTree", () => ({
  CombinedConnectionsTree: () => <div data-testid="connections-tree" />,
}));
vi.mock("@domains/chart/components/ChartEditorPanel", () => ({
  ChartEditorPanel: () => <div data-testid="chart-editor" />,
}));
vi.mock("@domains/pinnedQueries/components/PinnedQueriesPane", () => ({
  PinnedQueriesPane: () => <div data-testid="pinned-queries" />,
}));
vi.mock("@domains/agent/components/AgentPane", () => ({
  AgentPane: () => <div data-testid="agent-pane" />,
}));
import { usePinnedQueriesStore } from "@domains/pinnedQueries/hooks";

import { RightSidebar } from ".";
import { useTabsStore } from "../../hooks/tabsStore";
import { useChartEditorStore } from "@domains/chart/hooks";
import { useAgentStore } from "@domains/agent/hooks";
beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeId: null, layout: null, focusedPaneGroupId: null });
  useChartEditorStore.setState({ targetTabId: null });
  useAgentStore.setState({ paneOpen: false });
  usePinnedQueriesStore.setState({ paneOpen: false });
});

describe("RightSidebar (registry-driven)", () => {
  it("renders the connections tree by default (lowest-priority fallback)", () => {
    render(<RightSidebar />);
    expect(screen.getByTestId("connections-tree")).toBeTruthy();
    expect(screen.queryByTestId("chart-editor")).toBeNull();
  });

  it("renders the chart editor, wrapped in mdbc-pane right, when open on a query tab", () => {
    useTabsStore.setState({
      tabs: [{ id: "q1", title: "Console 1", text: "", kind: "sql", cursor: 0, tabType: "console" }],
      activeId: "q1",
    } as never);
    useChartEditorStore.setState({ targetTabId: "q1" });
    const { container } = render(<RightSidebar />);
    expect(screen.getByTestId("chart-editor")).toBeTruthy();
    expect(screen.queryByTestId("connections-tree")).toBeNull();
    expect(container.querySelector(".mdbc-pane.right")).toBeTruthy();
  });

  it("falls back to the connections tree when the chart editor is open but the tab is a terminal", () => {
    useTabsStore.setState({
      tabs: [{ id: "t1", title: "Terminal 1", text: "", kind: "terminal", cursor: 0, tabType: "terminal" }],
      activeId: "t1",
    } as never);
    useChartEditorStore.setState({ targetTabId: "t1" });
    render(<RightSidebar />);
    expect(screen.getByTestId("connections-tree")).toBeTruthy();
  });

  it("prioritizes the agent pane over every other right pane when open", () => {
    useAgentStore.setState({ paneOpen: true });
    usePinnedQueriesStore.setState({ paneOpen: true });
    render(<RightSidebar />);
    expect(screen.getByTestId("agent-pane")).toBeTruthy();
    expect(screen.queryByTestId("pinned-queries")).toBeNull();
  });

  it("renders pinned queries over the connections default when open", () => {
    usePinnedQueriesStore.setState({ paneOpen: true });
    render(<RightSidebar />);
    expect(screen.getByTestId("pinned-queries")).toBeTruthy();
    expect(screen.queryByTestId("connections-tree")).toBeNull();
  });
});
