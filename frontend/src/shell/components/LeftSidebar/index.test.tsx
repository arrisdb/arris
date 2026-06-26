import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));
import { LeftSidebar } from ".";
import { useSettingsStore } from "@shared/settings";
import { useFilesStore } from "@domains/files/hooks";
import { useTabsStore } from "../../hooks/tabsStore";
import { useRecentsStore } from "@shell/hooks/recentsStore";

beforeEach(() => {
  localStorage.clear();
  useFilesStore.setState({
    rootPath: null,
    tree: null,
    isLoading: false,
    loadError: null,
    expanded: new Set<string>(),
    selectedPath: null,
  });
  useTabsStore.setState({ tabs: [], activeId: null });
  useRecentsStore.setState({ recents: [] });
  useSettingsStore.setState({ sidebarLeftTab: "git" });
});

describe("LeftSidebar has no pinned header", () => {
  it("does not render a project label or branch chip", () => {
    useFilesStore.setState({ rootPath: "/tmp/proj" });
    render(<LeftSidebar />);
    expect(screen.queryByTestId("left-sidebar-project-label")).toBeNull();
    expect(screen.queryByTestId("left-sidebar-branch-chip")).toBeNull();
  });
});

describe("LeftSidebar empty-project state", () => {
  it("renders the EmptyProjectPane on the Files tab when no project is opened", () => {
    useSettingsStore.setState({ sidebarLeftTab: "files" });
    render(<LeftSidebar />);
    expect(screen.getByTestId("empty-project-pane")).toBeTruthy();
    expect(screen.getByTestId("start-project-card")).toBeTruthy();
  });

  it("does not render the empty pane once a project is loaded", () => {
    useSettingsStore.setState({ sidebarLeftTab: "files" });
    useFilesStore.setState({ rootPath: "/tmp/proj" });
    render(<LeftSidebar />);
    expect(screen.queryByTestId("empty-project-pane")).toBeNull();
  });
});

describe("pane titles never show counts", () => {
  it("Source Control title has no numeric count", () => {
    useSettingsStore.setState({ sidebarLeftTab: "git" });
    const { container } = render(<LeftSidebar />);
    const title = container.querySelector(".mdbc-pane-title");
    expect(title?.textContent).toBe("Source Control");
  });
});

describe("ConsolesSection visibility", () => {
  const consoleTab = {
    id: "c1",
    title: "Console 1",
    text: "",
    kind: "sql",
    cursor: 0,
    tabType: "console" as const,
  };

  it("renders ConsolesSection on Files tab", () => {
    useSettingsStore.setState({ sidebarLeftTab: "files" });
    useTabsStore.setState({ tabs: [consoleTab], activeId: "c1" });
    render(<LeftSidebar />);
    expect(screen.getByTestId("consoles-section")).toBeTruthy();
  });

  it("hides ConsolesSection on git tab", () => {
    useSettingsStore.setState({ sidebarLeftTab: "git" });
    useTabsStore.setState({ tabs: [consoleTab], activeId: "c1" });
    render(<LeftSidebar />);
    expect(screen.queryByTestId("consoles-section")).toBeNull();
  });
});
