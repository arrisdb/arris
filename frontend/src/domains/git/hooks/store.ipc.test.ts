import { describe, it, expect, beforeEach, vi } from "vitest";
import { useGitStore } from "./store";
import { useSnackbarStore } from "@shell/hooks/snackbarStore";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("git store IPC wiring", () => {
  beforeEach(() => {
    useGitStore.setState({
      repoPath: null,
      worktrees: [],
      branches: [],
      currentBranch: null,
      fileStatuses: [],
      diffStats: new Map(),
      selectedFile: null,
      commitMessage: "",
      lastCommit: null,
      aheadBehind: [0, 0],
      isPickerOpen: false,
      isWorktreePickerOpen: false,
      isLoading: false,
      isCommitting: false,
      isPushing: false,
      loadError: null,
      commitError: null,
      lastPushOutput: null,
      hasRemote: false,
      hasUpstream: false,
      remotes: [],
    });
    useSnackbarStore.setState({ snackbars: [] });
    mockInvoke.mockReset();
  });

  it("refreshFromRepo loads current branch, branches, statuses, last commit, ahead/behind, and worktrees", async () => {
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case "cmd_git_current_branch":
          return Promise.resolve("main");
        case "cmd_git_list_branches":
          return Promise.resolve([
            { name: "main", isCurrent: true, isRemote: false },
            { name: "origin/main", isCurrent: false, isRemote: true },
          ]);
        case "cmd_git_file_statuses":
          return Promise.resolve([
            { path: "/repo/a.txt", status: "M", indexStatus: " ", worktreeStatus: "M" },
          ]);
        case "cmd_git_last_commit":
          return Promise.resolve({
            id: "abc123",
            summary: "init",
            author: "Test",
            timestamp: 1000,
          });
        case "cmd_git_ahead_behind":
          return Promise.resolve([2, 0]);
        case "cmd_git_push_state":
          return Promise.resolve({ hasRemote: true, hasUpstream: true });
        case "cmd_git_file_diff_stats":
          return Promise.resolve([["/repo/a.txt", 5, 3]]);
        case "cmd_git_worktree_name":
          return Promise.resolve("main worktree");
        case "cmd_git_worktree_list":
          return Promise.resolve([
            { path: "/repo", branch: "main", head: "abc123", isMain: true },
          ]);
        case "cmd_git_list_remotes":
          return Promise.resolve([{ name: "origin", url: "https://github.com/x/y.git" }]);
        default:
          return Promise.reject(new Error(`unexpected command ${command}`));
      }
    });

    await useGitStore.getState().refreshFromRepo("/repo");

    const state = useGitStore.getState();
    expect(mockInvoke).toHaveBeenCalledWith("cmd_git_current_branch", { repo: "/repo" });
    expect(state.remotes).toEqual([{ name: "origin", url: "https://github.com/x/y.git" }]);
    expect(state.repoPath).toBe("/repo");
    expect(state.currentBranch).toBe("main");
    expect(state.branches).toHaveLength(2);
    expect(state.branches[1].isRemote).toBe(true);
    expect(state.fileStatuses).toHaveLength(1);
    expect(state.fileStatuses[0].status).toBe("M");
    expect(state.lastCommit?.summary).toBe("init");
    expect(state.aheadBehind).toEqual([2, 0]);
    expect(state.hasRemote).toBe(true);
    expect(state.hasUpstream).toBe(true);
    expect(state.diffStats.get("/repo/a.txt")).toEqual({ added: 5, deleted: 3 });
    expect(state.worktrees).toHaveLength(1);
    expect(state.worktrees[0].isMain).toBe(true);
  });

  it("refreshFromRepo records load error on rejection", async () => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === "cmd_git_current_branch") {
        return Promise.reject(new Error("not a repo"));
      }
      if (command === "cmd_git_last_commit") return Promise.resolve(null);
      if (command === "cmd_git_ahead_behind") return Promise.resolve([0, 0]);
      if (command === "cmd_git_file_diff_stats") return Promise.resolve([]);
      if (command === "cmd_git_worktree_name") return Promise.resolve("main worktree");
      if (command === "cmd_git_worktree_list") return Promise.resolve([]);
      return Promise.resolve([]);
    });

    await useGitStore.getState().refreshFromRepo("/bad");

    expect(useGitStore.getState().loadError).toContain("not a repo");
  });

  it("refreshFileStatuses updates current branch for external branch changes", async () => {
    useGitStore.setState({ repoPath: "/repo", currentBranch: "main" });
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case "cmd_git_current_branch":
          return Promise.resolve("feature");
        case "cmd_git_file_statuses":
          return Promise.resolve([]);
        case "cmd_git_ahead_behind":
          return Promise.resolve([0, 0]);
        case "cmd_git_push_state":
          return Promise.resolve({ hasRemote: true, hasUpstream: false });
        case "cmd_git_file_diff_stats":
          return Promise.resolve([]);
        default:
          return Promise.reject(new Error(`unexpected command ${command}`));
      }
    });

    await useGitStore.getState().refreshFileStatuses();

    const state = useGitStore.getState();
    expect(state.currentBranch).toBe("feature");
    expect(state.hasRemote).toBe(true);
    expect(state.hasUpstream).toBe(false);
  });

  it("push records the push output and refreshes push state", async () => {
    useGitStore.setState({ repoPath: "/repo" });
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case "cmd_git_push":
          return Promise.resolve("Branch 'main' set up to track 'origin/main'.");
        case "cmd_git_ahead_behind":
          return Promise.resolve([0, 0]);
        case "cmd_git_push_state":
          return Promise.resolve({ hasRemote: true, hasUpstream: true });
        default:
          return Promise.reject(new Error(`unexpected command ${command}`));
      }
    });

    await useGitStore.getState().push();

    const state = useGitStore.getState();
    expect(mockInvoke).toHaveBeenCalledWith("cmd_git_push", { repo: "/repo" });
    expect(state.isPushing).toBe(false);
    expect(state.lastPushOutput).toContain("set up to track");
    expect(state.hasUpstream).toBe(true);
    const { snackbars } = useSnackbarStore.getState();
    expect(snackbars).toHaveLength(1);
    expect(snackbars[0].kind).toBe("success");
    expect(snackbars[0].message).toContain("set up to track");
  });

  it("push surfaces an error snackbar when the push fails", async () => {
    useGitStore.setState({ repoPath: "/repo" });
    mockInvoke.mockImplementation((command: string) => {
      if (command === "cmd_git_push") {
        return Promise.reject(new Error("git push failed: no remote configured"));
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    });

    await useGitStore.getState().push();

    const state = useGitStore.getState();
    expect(state.isPushing).toBe(false);
    expect(state.lastPushOutput).toContain("no remote configured");
    const { snackbars } = useSnackbarStore.getState();
    expect(snackbars).toHaveLength(1);
    expect(snackbars[0].kind).toBe("error");
    expect(snackbars[0].message).toContain("no remote configured");
  });

  it("setRemoteUrl writes the new URL, clears the push output, and reloads remotes", async () => {
    useGitStore.setState({
      repoPath: "/repo",
      lastPushOutput: "git push failed: This repository moved.",
      remotes: [{ name: "origin", url: "https://github.com/x/old.git" }],
    });
    mockInvoke.mockImplementation((command: string) => {
      switch (command) {
        case "cmd_git_set_remote_url":
          return Promise.resolve(undefined);
        case "cmd_git_list_remotes":
          return Promise.resolve([{ name: "origin", url: "https://github.com/x/new.git" }]);
        case "cmd_git_push_state":
          return Promise.resolve({ hasRemote: true, hasUpstream: true });
        default:
          return Promise.reject(new Error(`unexpected command ${command}`));
      }
    });

    await useGitStore.getState().setRemoteUrl("origin", "https://github.com/x/new.git");

    const state = useGitStore.getState();
    expect(mockInvoke).toHaveBeenCalledWith("cmd_git_set_remote_url", {
      repo: "/repo",
      name: "origin",
      url: "https://github.com/x/new.git",
    });
    expect(state.lastPushOutput).toBeNull();
    expect(state.remotes).toEqual([{ name: "origin", url: "https://github.com/x/new.git" }]);
    expect(state.hasUpstream).toBe(true);
  });
});
