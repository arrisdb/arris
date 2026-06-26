import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@domains/git/components/GitChangesPane/ipc", () => ({
  gitChangesPaneDiscardFilesIPC: vi.fn().mockResolvedValue(undefined),
  gitChangesPaneCurrentBranchIPC: vi.fn().mockResolvedValue("main"),
  gitChangesPaneFileStatusesIPC: vi.fn().mockResolvedValue([]),
  gitChangesPaneAheadBehindIPC: vi.fn().mockResolvedValue([0, 0]),
  gitChangesPaneFileDiffStatsIPC: vi.fn().mockResolvedValue([]),
  gitChangesPanePushStateIPC: vi.fn().mockResolvedValue({ hasRemote: false, hasUpstream: false }),
  gitChangesPaneMergeStateIPC: vi
    .fn()
    .mockResolvedValue({ inProgress: false, kind: "none", conflicted: [] }),
  gitChangesPanePushIPC: vi.fn().mockResolvedValue("Pushed."),
  gitChangesPanePushToIPC: vi.fn().mockResolvedValue("Pushed to."),
  gitChangesPaneForcePushIPC: vi.fn().mockResolvedValue("Force-pushed."),
  gitChangesPanePullIPC: vi.fn().mockResolvedValue({ message: "Already up to date.", conflicted: [] }),
  gitChangesPanePullFromIPC: vi
    .fn()
    .mockResolvedValue({ message: "Already up to date.", conflicted: [] }),
}));

vi.mock("@shell/ipc", () => ({
  readTextFileIPC: vi.fn().mockResolvedValue("HEAD CONTENT"),
}));

import { useGitStore } from "./store";
import { useTabsStore } from "@shell/hooks/tabsStore";
import {
  gitChangesPaneForcePushIPC,
  gitChangesPanePullFromIPC,
  gitChangesPanePushToIPC,
} from "@domains/git/components/GitChangesPane/ipc";

describe("git store", () => {
  beforeEach(() => {
    useGitStore.setState({
      repoPath: null,
      branches: [],
      currentBranch: null,
      fileStatuses: [],
      isPickerOpen: false,
    });
    useTabsStore.setState({ tabs: [], activeId: null, layout: null, focusedPaneGroupId: null });
  });

  it("setBranches and setCurrent persist", () => {
    useGitStore.getState().setBranches([
      { name: "main", isCurrent: true, isRemote: false },
    ]);
    useGitStore.getState().setCurrent("main");
    expect(useGitStore.getState().branches).toHaveLength(1);
    expect(useGitStore.getState().currentBranch).toBe("main");
  });

  it("openPicker / closePicker toggle isPickerOpen", () => {
    useGitStore.getState().openPicker();
    expect(useGitStore.getState().isPickerOpen).toBe(true);
    useGitStore.getState().closePicker();
    expect(useGitStore.getState().isPickerOpen).toBe(false);
  });

  it("discardFiles reloads open editor tabs from disk so the change can't reappear", async () => {
    useGitStore.setState({ repoPath: "/repo" });
    const tab = useTabsStore.getState().openFileTab({
      filePath: "/repo/macros/cents_to_dollars.sql",
      title: "cents_to_dollars.sql",
      text: "MODIFIED IN MEMORY",
      kind: "sql",
    });

    await useGitStore.getState().discardFiles(["/repo/macros/cents_to_dollars.sql"]);

    const reloaded = useTabsStore.getState().tabs.find((t) => t.id === tab.id)!;
    expect(reloaded.text).toBe("HEAD CONTENT");
    expect(reloaded.refreshToken).toBe(1);
  });

  it("discardFiles leaves tabs for other files untouched", async () => {
    useGitStore.setState({ repoPath: "/repo" });
    const other = useTabsStore.getState().openFileTab({
      filePath: "/repo/other.sql",
      title: "other.sql",
      text: "UNRELATED EDIT",
      kind: "sql",
    });

    await useGitStore.getState().discardFiles(["/repo/macros/cents_to_dollars.sql"]);

    const untouched = useTabsStore.getState().tabs.find((t) => t.id === other.id)!;
    expect(untouched.text).toBe("UNRELATED EDIT");
    expect(untouched.refreshToken).toBeUndefined();
  });

  it("pullFrom passes the explicit remote and branch to the IPC layer", async () => {
    useGitStore.setState({ repoPath: "/repo" });
    await useGitStore.getState().pullFrom("upstream", "develop");
    expect(gitChangesPanePullFromIPC).toHaveBeenCalledWith("/repo", "upstream", "develop", "merge");
    expect(useGitStore.getState().isPulling).toBe(false);
  });

  it("pushTo pushes the named remote and branch", async () => {
    useGitStore.setState({ repoPath: "/repo" });
    await useGitStore.getState().pushTo("origin", "feature");
    expect(gitChangesPanePushToIPC).toHaveBeenCalledWith("/repo", "origin", "feature");
    expect(useGitStore.getState().pushMessage).toBe("Pushed to.");
  });

  it("forcePush force-pushes the current branch and reports the result", async () => {
    useGitStore.setState({ repoPath: "/repo" });
    await useGitStore.getState().forcePush();
    expect(gitChangesPaneForcePushIPC).toHaveBeenCalledWith("/repo");
    expect(useGitStore.getState().pushMessage).toBe("Force-pushed.");
  });
});
