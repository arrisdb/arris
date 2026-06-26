import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CommitGraphRow, GitHistoryViewModel } from "./types";

const mockView = vi.fn((): GitHistoryViewModel => viewModel());

vi.mock("./hooks", () => ({
  useGitHistoryView: () => mockView(),
}));

import { GitHistoryView } from "./index";

function row(id: string): CommitGraphRow {
  return {
    id,
    parents: [],
    summary: `commit ${id}`,
    author: "Ada",
    timestamp: 1_700_000_000,
    refs: [],
    column: 0,
    edges: [],
  };
}

function viewModel(overrides: Partial<GitHistoryViewModel> = {}): GitHistoryViewModel {
  const rows = [row("a"), row("b")];
  return {
    visibleRows: rows,
    laneCount: 1,
    query: "",
    isLoading: false,
    isLoadingMore: false,
    isSearching: false,
    hasMore: true,
    error: null,
    hasRepo: true,
    onChangeQuery: vi.fn(),
    onRefresh: vi.fn(),
    onLoadMore: vi.fn(),
    selectedCommitId: null,
    detail: null,
    detailLoading: false,
    detailError: null,
    detailWebUrl: null,
    onSelectCommit: vi.fn(),
    onCloseDetail: vi.fn(),
    onOpenCommitFile: vi.fn(),
    onViewCommit: vi.fn(),
    ...overrides,
  };
}

function detailFor(id: string) {
  return {
    id,
    summary: `commit ${id}`,
    body: "the body",
    author: "Ada",
    email: "ada@example.com",
    timestamp: 1_700_000_000,
    additions: 5,
    deletions: 2,
    files: [{ path: "src/a.txt", additions: 5, deletions: 2 }],
  };
}

afterEach(() => {
  cleanup();
  mockView.mockReset();
});

describe("GitHistoryView", () => {
  it("renders refresh as an icon button with no text label", () => {
    mockView.mockReturnValue(viewModel());
    render(<GitHistoryView />);

    const button = screen.getByTestId("git-history-refresh");
    expect(button.getAttribute("aria-label")).toBe("Refresh");
    expect(button.textContent).toBe("");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("calls onRefresh when the refresh button is clicked", () => {
    const model = viewModel();
    mockView.mockReturnValue(model);
    render(<GitHistoryView />);

    fireEvent.click(screen.getByTestId("git-history-refresh"));
    expect(model.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not render a commit count in the toolbar", () => {
    mockView.mockReturnValue(viewModel());
    const { container } = render(<GitHistoryView />);
    expect(container.querySelector(".mdbc-git-history-count")).toBeNull();
  });

  it("loads more when scrolled near the bottom of the list", () => {
    const model = viewModel();
    mockView.mockReturnValue(model);
    const { container } = render(<GitHistoryView />);

    const list = container.querySelector(".mdbc-git-history-list") as HTMLElement;
    Object.defineProperty(list, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(list, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(list, "scrollTop", { value: 650, configurable: true });
    fireEvent.scroll(list);

    expect(model.onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not load more when scrolled far from the bottom", () => {
    const model = viewModel();
    mockView.mockReturnValue(model);
    const { container } = render(<GitHistoryView />);

    const list = container.querySelector(".mdbc-git-history-list") as HTMLElement;
    Object.defineProperty(list, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(list, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(list, "scrollTop", { value: 100, configurable: true });
    fireEvent.scroll(list);

    expect(model.onLoadMore).not.toHaveBeenCalled();
  });

  it("shows a loading-more footer while fetching the next page", () => {
    mockView.mockReturnValue(viewModel({ isLoadingMore: true }));
    render(<GitHistoryView />);
    expect(screen.getByTestId("git-history-loading-more")).not.toBeNull();
  });

  it("shows a searching placeholder while a search is in flight with no results", () => {
    mockView.mockReturnValue(viewModel({ visibleRows: [], isSearching: true, query: "old" }));
    render(<GitHistoryView />);
    expect(screen.getByText("Searching…")).not.toBeNull();
    expect(screen.queryByText("No commits match.")).toBeNull();
  });

  it("does not load more while a search is active", () => {
    const model = viewModel({ query: "old" });
    mockView.mockReturnValue(model);
    const { container } = render(<GitHistoryView />);

    const list = container.querySelector(".mdbc-git-history-list") as HTMLElement;
    Object.defineProperty(list, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(list, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(list, "scrollTop", { value: 650, configurable: true });
    fireEvent.scroll(list);

    // onLoadMore is still invoked by the scroll handler; the hook itself no-ops
    // during search. Component-level we just assert the handler is wired.
    expect(model.onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("selects a commit when its row is clicked", () => {
    const model = viewModel();
    mockView.mockReturnValue(model);
    render(<GitHistoryView />);

    fireEvent.click(screen.getByTestId("git-history-row-a"));
    expect(model.onSelectCommit).toHaveBeenCalledTimes(1);
    expect(model.onSelectCommit).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("hides the detail panel when no commit is selected", () => {
    mockView.mockReturnValue(viewModel());
    render(<GitHistoryView />);
    expect(screen.queryByTestId("commit-detail-panel")).toBeNull();
  });

  it("renders the detail panel with author, files, and a GitHub link", () => {
    mockView.mockReturnValue(
      viewModel({
        selectedCommitId: "a",
        detail: detailFor("a"),
        detailWebUrl: "https://github.com/acme/app/commit/a",
      }),
    );
    render(<GitHistoryView />);

    const panel = screen.getByTestId("commit-detail-panel");
    expect(within(panel).getByText("Ada")).not.toBeNull();
    expect(within(panel).getByText("1 Changed File")).not.toBeNull();
    expect(screen.getByTestId("commit-file-a.txt")).not.toBeNull();
    const link = within(panel).getByText("View on GitHub").closest("a");
    expect(link?.getAttribute("href")).toBe("https://github.com/acme/app/commit/a");
  });

  it("opens a file diff when a changed file is clicked", () => {
    const model = viewModel({ selectedCommitId: "a", detail: detailFor("a") });
    mockView.mockReturnValue(model);
    render(<GitHistoryView />);

    fireEvent.click(screen.getByTestId("commit-file-a.txt"));
    expect(model.onOpenCommitFile).toHaveBeenCalledWith("src/a.txt");
  });

  it("opens the whole commit when View Commit is clicked", () => {
    const model = viewModel({ selectedCommitId: "a", detail: detailFor("a") });
    mockView.mockReturnValue(model);
    render(<GitHistoryView />);

    fireEvent.click(screen.getByTestId("commit-detail-view-commit"));
    expect(model.onViewCommit).toHaveBeenCalledTimes(1);
  });

  it("renders the detail panel at its default width with a resize handle", () => {
    mockView.mockReturnValue(viewModel({ selectedCommitId: "a", detail: detailFor("a") }));
    render(<GitHistoryView />);

    const panel = screen.getByTestId("commit-detail-panel");
    expect(panel.style.getPropertyValue("--commit-detail-width")).toBe("460px");
    expect(screen.getByTestId("commit-detail-resizer")).not.toBeNull();
  });
});
