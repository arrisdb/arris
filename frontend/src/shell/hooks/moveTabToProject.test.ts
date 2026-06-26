import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMoveTabToProject } from "./moveTabToProject";
import { useTabsStore } from "./tabsStore";
import { useFilesStore } from "@domains/files/hooks";
import { moveTabToProjectIPC, saveTabsIPC } from "../ipc";

// Only the two IPC boundaries this hook drives are stubbed; the rest of ../ipc
// keeps its real bindings.
vi.mock("../ipc", async (orig) => ({
  ...(await orig<typeof import("../ipc")>()),
  moveTabToProjectIPC: vi.fn(),
  saveTabsIPC: vi.fn(),
}));

describe("useMoveTabToProject", () => {
  beforeEach(() => {
    useTabsStore.setState({
      tabs: [
        {
          id: "t1",
          title: "Console 1",
          text: "SELECT 1",
          kind: "sql",
          cursor: 0,
          tabType: "console",
          createdAt: 1,
        },
      ] as never,
    });
    useFilesStore.setState({ refresh: vi.fn(() => Promise.resolve()) } as never);
    vi.mocked(saveTabsIPC).mockResolvedValue(undefined);
    vi.mocked(moveTabToProjectIPC).mockResolvedValue("/proj/Console 1.sql");
  });

  it("flushes tabs, moves the file, binds filePath and refreshes the tree", async () => {
    const { result } = renderHook(() => useMoveTabToProject());
    await act(async () => {
      await result.current("t1");
    });
    expect(saveTabsIPC).toHaveBeenCalled();
    expect(moveTabToProjectIPC).toHaveBeenCalledWith("t1");
    const tab = useTabsStore.getState().tabs.find((t) => t.id === "t1");
    expect(tab?.filePath).toBe("/proj/Console 1.sql");
    expect(useFilesStore.getState().refresh).toHaveBeenCalled();
  });
});
