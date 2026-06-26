import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { registerTabView } from "@shared";
import type { EditorTab } from "@shell/types";

vi.mock("../ConsoleTabView", () => ({
  ConsoleTabView: ({ activeTab }: { activeTab: EditorTab | null }) => (
    <div data-testid="console-tab-view">{activeTab?.id ?? "empty"}</div>
  ),
}));

vi.mock("../TableTabView", () => ({
  TableTabView: ({ activeTab }: { activeTab: EditorTab }) => (
    <div data-testid="table-tab-view">{activeTab.id}</div>
  ),
}));

vi.mock("../CsvTableView", () => ({
  CsvTableView: ({ tab }: { tab: EditorTab }) => (
    <div data-testid="csv-tab-view">{tab.id}</div>
  ),
}));


import { EditorTabRouter } from "./index";

// Domain-contributed tab views are registered at app startup; register the one
// under test here (the router resolves it from the registry).
beforeAll(() => {
  registerTabView({ tabType: "gitdiff", Component: () => <div data-testid="git-diff-view" /> });
});

function tab(overrides: Partial<EditorTab>): EditorTab {
  return {
    id: "t1",
    title: "Tab",
    text: "",
    kind: "sql",
    cursor: 0,
    ...overrides,
  } as EditorTab;
}

describe("EditorTabRouter", () => {
  it("routes console/file tabs to ConsoleTabView", () => {
    render(<EditorTabRouter activeTab={tab({ tabType: "console" })} consoleProps={{} as any} tableProps={{} as any} />);
    expect(screen.getByTestId("console-tab-view").textContent).toBe("t1");
  });

  it("routes table tabs to TableTabView", () => {
    render(<EditorTabRouter activeTab={tab({ tabType: "table" })} consoleProps={{} as any} tableProps={{} as any} />);
    expect(screen.getByTestId("table-tab-view").textContent).toBe("t1");
  });

  it("routes csv tabs to CsvTableView before generic console handling", () => {
    render(<EditorTabRouter activeTab={tab({ kind: "csv" })} consoleProps={{} as any} tableProps={{} as any} />);
    expect(screen.getByTestId("csv-tab-view").textContent).toBe("t1");
  });

  it("routes gitdiff tabs to GitDiffView", () => {
    render(<EditorTabRouter activeTab={tab({ tabType: "gitdiff" })} consoleProps={{} as any} tableProps={{} as any} />);
    expect(screen.getByTestId("git-diff-view")).toBeTruthy();
  });

  it("does not render duplicate active content for terminal tabs", () => {
    const { container } = render(<EditorTabRouter activeTab={tab({ tabType: "terminal" })} consoleProps={{} as any} tableProps={{} as any} />);
    expect(container.textContent).toBe("");
  });
});
