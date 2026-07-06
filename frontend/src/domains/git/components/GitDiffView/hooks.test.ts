import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const mockFileDiffHunks = vi.hoisted(() => vi.fn());

vi.mock("./ipc", () => ({
  gitDiffViewFileDiffHunksIPC: (...args: unknown[]) => mockFileDiffHunks(...args),
}));

import { useGitDiffView } from "./hooks";
import { useGitStore } from "../../hooks";
import { useFilesStore } from "@domains/files/hooks";

const FILE_A = { path: "/repo/a.txt", status: "M", indexStatus: " ", worktreeStatus: "M" };
const HUNK = { header: "@@ -1 +1 @@", lines: [] };

beforeEach(() => {
  useFilesStore.setState({ rootPath: "/repo" });
  useGitStore.setState({ fileStatuses: [FILE_A], selectedFile: null });
  mockFileDiffHunks.mockReset();
  mockFileDiffHunks.mockResolvedValue([HUNK]);
});

describe("useGitDiffView", () => {
  it("loads diffs and clears the loading state", async () => {
    const { result } = renderHook(() => useGitDiffView());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.fileDiffs).toHaveLength(1);
    expect(result.current.fileDiffs[0].path).toBe("/repo/a.txt");
  });

  it("keeps showing previous diffs while a status change refetches (no loading flash)", async () => {
    const { result } = renderHook(() => useGitDiffView());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Hold the refetch open to observe the in-flight state.
    let resolveRefetch!: (value: unknown) => void;
    mockFileDiffHunks.mockImplementation(
      () => new Promise((resolve) => { resolveRefetch = resolve; }),
    );

    // Stage/unstage refreshes statuses with a new array identity.
    act(() => {
      useGitStore.setState({ fileStatuses: [{ ...FILE_A, indexStatus: "M" }] });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.fileDiffs).toHaveLength(1);

    await act(async () => {
      resolveRefetch([HUNK]);
    });
    await waitFor(() => expect(result.current.fileDiffs).toHaveLength(1));
    expect(result.current.loading).toBe(false);
  });

  it("preserves per-file collapsed state across refetches", async () => {
    const { result } = renderHook(() => useGitDiffView());
    await waitFor(() => expect(result.current.fileDiffs).toHaveLength(1));

    act(() => {
      result.current.onToggleCollapse(0);
    });
    expect(result.current.fileDiffs[0].collapsed).toBe(true);

    act(() => {
      useGitStore.setState({ fileStatuses: [{ ...FILE_A, indexStatus: "M" }] });
    });
    await waitFor(() => expect(result.current.fileDiffs[0].collapsed).toBe(true));
  });
});
