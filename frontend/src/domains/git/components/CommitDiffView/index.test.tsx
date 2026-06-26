import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CommitDiffViewModel } from "./types";
import type { EditorTab } from "@shell/types";

const mockView = vi.fn((): CommitDiffViewModel => viewModel());

vi.mock("./hooks", () => ({
  useCommitDiffView: () => mockView(),
}));

import { CommitDiffView } from "./index";

const TAB = { id: "t1", commitId: "abc1234def", filePath: "src/a.txt" } as EditorTab;

function viewModel(overrides: Partial<CommitDiffViewModel> = {}): CommitDiffViewModel {
  return {
    detail: {
      id: "abc1234def",
      summary: "Add feature",
      body: "the body",
      author: "Manfred Lee",
      email: "m@example.com",
      timestamp: 1_700_000_000,
      additions: 12,
      deletions: 3,
      files: [{ path: "src/a.txt", additions: 12, deletions: 3 }],
    },
    fileDiffs: [
      {
        path: "src/a.txt",
        collapsed: false,
        hunks: [
          {
            oldStart: 1,
            oldCount: 1,
            newStart: 1,
            newCount: 1,
            lines: [{ kind: "add", text: "hello" }],
          },
        ],
      },
    ],
    loading: false,
    error: null,
    repoPath: "/repo",
    focusPath: "src/a.txt",
    onToggleCollapse: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mockView.mockReset();
});

describe("CommitDiffView", () => {
  it("renders the commit metadata header", () => {
    mockView.mockReturnValue(viewModel());
    render(<CommitDiffView activeTab={TAB} />);

    expect(screen.getByText("Manfred Lee")).not.toBeNull();
    expect(screen.getByText("m@example.com")).not.toBeNull();
    expect(screen.getByText("Add feature")).not.toBeNull();
    // Short SHA badge (first 7 chars).
    expect(screen.getByText("abc1234")).not.toBeNull();
    expect(screen.getByText("+12")).not.toBeNull();
    expect(screen.getByText("−3")).not.toBeNull();
  });

  it("renders a diff section per changed file", () => {
    mockView.mockReturnValue(viewModel());
    render(<CommitDiffView activeTab={TAB} />);
    expect(screen.getByTestId("diff-file-a.txt")).not.toBeNull();
  });

  it("shows an empty state when the commit has no changes", () => {
    mockView.mockReturnValue(viewModel({ fileDiffs: [], detail: null }));
    render(<CommitDiffView activeTab={TAB} />);
    expect(screen.getByText("No changes in this commit.")).not.toBeNull();
  });

  it("shows a loading state while fetching", () => {
    mockView.mockReturnValue(viewModel({ loading: true }));
    render(<CommitDiffView activeTab={TAB} />);
    expect(screen.getByText("Loading commit…")).not.toBeNull();
  });
});
