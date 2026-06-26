import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@shell/hooks/projectStore", () => ({
  useProjectStore: {
    getState: () => ({
      openProject: vi.fn(async () => undefined),
    }),
  },
}));

import { EmptyProjectPane } from "./index";
import { useRecentsStore } from "@shell/hooks/recentsStore";

beforeEach(() => {
  localStorage.clear();
  mockInvoke.mockResolvedValue("");
  useRecentsStore.setState({ recents: [] });
});

describe("EmptyProjectPane", () => {
  it("renders the start-project card with primary + secondary actions", () => {
    render(<EmptyProjectPane />);
    expect(screen.getByTestId("start-project-card")).toBeTruthy();
    expect(screen.getByTestId("start-new-project").textContent).toContain("New project");
    expect(screen.getByTestId("start-open-folder").textContent).toContain("Open folder");
  });

  it("shows the empty-recents message when no projects opened yet", () => {
    render(<EmptyProjectPane />);
    expect(screen.getByTestId("recent-empty").textContent).toContain("No recent projects");
  });

  it("renders one row per recent entry, newest first", () => {
    useRecentsStore.setState({
      recents: [
        { path: "/x/dbt_growth", name: "dbt_growth", kind: "folder", openedAt: Date.now() },
        { path: "/x/warehouse", name: "warehouse", kind: "folder", openedAt: Date.now() - 60000 },
      ],
    });
    render(<EmptyProjectPane />);
    expect(screen.getByTestId("recent-row-/x/dbt_growth")).toBeTruthy();
    expect(screen.getByTestId("recent-row-/x/warehouse")).toBeTruthy();
  });

  it("does not render a tip row", () => {
    render(<EmptyProjectPane />);
    expect(screen.queryByTestId("tip-row")).toBeNull();
  });
});
