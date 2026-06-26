import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@domains/git/components/GitChangesPane/ipc", () => ({
  gitChangesPaneAheadBehindIPC: vi.fn(async () => [0, 0]),
  gitChangesPaneCommitIPC: vi.fn(),
  gitChangesPaneCurrentBranchIPC: vi.fn(async () => "main"),
  gitChangesPaneDeleteBranchIPC: vi.fn(async () => undefined),
  gitChangesPaneRemoveWorktreeIPC: vi.fn(async () => undefined),
  gitChangesPaneFileDiffStatsIPC: vi.fn(async () => []),
  gitChangesPaneFileStatusesIPC: vi.fn(async () => []),
  gitChangesPaneLastCommitIPC: vi.fn(async () => null),
  gitChangesPaneListBranchesIPC: vi.fn(async () => []),
  gitChangesPanePushIPC: vi.fn(),
  gitChangesPanePushStateIPC: vi.fn(async () => ({ hasRemote: false, hasUpstream: false })),
  gitChangesPaneStageAllIPC: vi.fn(),
  gitChangesPaneStageFilesIPC: vi.fn(),
  gitChangesPaneUnstageAllIPC: vi.fn(),
  gitChangesPaneUnstageFilesIPC: vi.fn(),
  gitChangesPaneWorktreeListIPC: vi.fn(async () => []),
  gitChangesPaneWorktreeNameIPC: vi.fn(async () => "main worktree"),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));
// The top bar mounts the UpdateButton, which checks for an app update on mount.
// Keep it inert (no update) so these tests don't reach the real updater plugin.
vi.mock("@shell/components/UpdateChecker/ipc", () => ({
  checkForUpdateIPC: vi.fn(async () => null),
  getAppVersionIPC: vi.fn(async () => "1.0.0"),
  downloadAndInstallIPC: vi.fn(async () => undefined),
  relaunchAppIPC: vi.fn(async () => undefined),
}));

import { TopBar } from ".";
import { projectNameFromPath, worktreeDisplayName, worktreeLabel } from "./utils";
import { useProjectStore } from "@shell/hooks/projectStore";
import { useFilesStore } from "@domains/files/hooks";
import { useGitStore } from "@domains/git/hooks";
import {
  gitChangesPaneCurrentBranchIPC,
  gitChangesPaneDeleteBranchIPC,
  gitChangesPaneListBranchesIPC,
  gitChangesPaneRemoveWorktreeIPC,
  gitChangesPaneWorktreeListIPC,
} from "@domains/git/components/GitChangesPane/ipc";
import { invoke } from "@tauri-apps/api/core";

describe("projectNameFromPath", () => {
  it("uses the final folder segment", () => {
    expect(projectNameFromPath("/tmp/work/arris")).toBe("arris");
    expect(projectNameFromPath("C:\\work\\arris")).toBe("arris");
  });

  it("falls back when no project path exists", () => {
    expect(projectNameFromPath(null)).toBe("No Project");
  });
});

describe("worktreeLabel", () => {
  it("returns 'main' for main worktree", () => {
    expect(worktreeLabel("main worktree")).toBe("main");
  });

  it("returns folder name for linked worktrees", () => {
    expect(worktreeLabel("arris-min-82")).toBe("arris-min-82");
  });

  it("returns null when no worktree name", () => {
    expect(worktreeLabel(null)).toBeNull();
  });
});

describe("worktreeDisplayName", () => {
  it("returns 'main worktree' for main worktree", () => {
    expect(worktreeDisplayName({ path: "/tmp/repo", branch: "main", head: "abc1234", isMain: true })).toBe("main worktree");
  });

  it("returns folder basename for linked worktrees", () => {
    expect(worktreeDisplayName({ path: "/tmp/work/arris-min-82", branch: "min-82", head: "def5678", isMain: false })).toBe("arris-min-82");
  });
});

describe("TopBar", () => {
  const branches = [
    { name: "main", isCurrent: true, isRemote: false },
    { name: "feature", isCurrent: false, isRemote: false },
    { name: "origin/dev", isCurrent: false, isRemote: true },
  ];

  const worktrees = [
    { path: "/tmp/work/arris", branch: "main", head: "abc1234567", isMain: true },
    { path: "/tmp/work/arris-min-82", branch: "min-82-feature", head: "def5678901", isMain: false },
  ];

  beforeEach(() => {
    useProjectStore.setState({ activeProjectPath: "/tmp/work/arris", loading: false });
    useFilesStore.setState({ rootPath: "/tmp/other" });
    useGitStore.setState({
      repoPath: "/tmp/work/arris",
      worktreeName: "main worktree",
      worktrees,
      branches,
      currentBranch: "main",
      isPickerOpen: false,
      isWorktreePickerOpen: false,
    });
    vi.clearAllMocks();
    vi.mocked(gitChangesPaneCurrentBranchIPC).mockResolvedValue("main");
    vi.mocked(gitChangesPaneListBranchesIPC).mockResolvedValue(branches);
    vi.mocked(gitChangesPaneWorktreeListIPC).mockResolvedValue(worktrees);
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("renders project, worktree label, and current branch", () => {
    render(<TopBar />);
    expect(screen.getByTestId("top-bar-project").textContent).toBe("arris");
    expect(screen.getByTestId("top-bar-worktree").textContent).toBe("main");
    expect(screen.getByTestId("top-bar-branch").textContent).toBe("main");
  });

  it("lays out project and git controls as shrinkable flex children so nothing clips", () => {
    render(<TopBar />);
    const left = screen.getByTestId("top-bar").querySelector(".mdbc-topbar-left");
    expect(left).not.toBeNull();

    // Project name is a shrinkable, ellipsis-truncating child.
    expect(screen.getByTestId("top-bar-project").classList.contains("mdbc-topbar-project")).toBe(true);

    // The worktree and branch buttons each live inside a popover-anchor wrapper,
    // the direct flex children that must shrink rather than overflow the window.
    const worktreeAnchor = screen.getByTestId("top-bar-worktree-btn").closest(".mdbc-topbar-popover-anchor");
    const branchAnchor = screen
      .getByRole("button", { name: /git branch: main/i })
      .closest(".mdbc-topbar-popover-anchor");
    expect(worktreeAnchor).not.toBeNull();
    expect(branchAnchor).not.toBeNull();
    expect(worktreeAnchor?.parentElement).toBe(left);
    expect(branchAnchor?.parentElement).toBe(left);
  });

  it("opens a Zed-style branch popover from the branch control", async () => {
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: /git branch: main/i }));
    await waitFor(() => {
      expect(gitChangesPaneListBranchesIPC).toHaveBeenCalled();
    });
    expect(useGitStore.getState().isPickerOpen).toBe(true);
    expect(screen.getByTestId("branch-popover")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Branches" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Stash" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Select branch...")).toBeTruthy();
    expect(screen.getByRole("option", { name: /main/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("opens the worktree picker from the worktree button", async () => {
    render(<TopBar />);
    fireEvent.click(screen.getByTestId("top-bar-worktree-btn"));
    await waitFor(() => {
      expect(gitChangesPaneWorktreeListIPC).toHaveBeenCalled();
    });
    expect(useGitStore.getState().isWorktreePickerOpen).toBe(true);
    expect(screen.getByTestId("worktree-popover")).toBeTruthy();
    expect(screen.getByPlaceholderText("Select a worktree...")).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[0].textContent).toContain("main worktree");
    expect(options[0].textContent).toContain("abc1234");
    expect(options[1].textContent).toContain("arris-min-82");
    expect(options[1].textContent).toContain("def5678");
  });

  it("closes worktree picker when opening branch picker", async () => {
    useGitStore.setState({ isWorktreePickerOpen: true });
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: /git branch: main/i }));
    await waitFor(() => {
      expect(gitChangesPaneListBranchesIPC).toHaveBeenCalled();
    });
    expect(useGitStore.getState().isWorktreePickerOpen).toBe(false);
    expect(useGitStore.getState().isPickerOpen).toBe(true);
  });

  it("falls back to the file root and disables branch switching without a repo", () => {
    useProjectStore.setState({ activeProjectPath: null });
    useFilesStore.setState({ rootPath: "/tmp/work/fallback" });
    useGitStore.setState({ repoPath: null, worktreeName: null, worktrees: [], currentBranch: null });
    render(<TopBar />);
    expect(screen.getByTestId("top-bar-project").textContent).toBe("fallback");
    expect(screen.getByTestId("top-bar-branch").textContent).toBe("No branch");
    expect(screen.queryByTestId("top-bar-worktree")).toBeNull();
    expect(screen.getByRole("button", { name: /git branch: no branch/i }).hasAttribute("disabled")).toBe(true);
  });

  it("filters branches and checks out remote branches through the existing IPC", async () => {
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: /git branch: main/i }));
    await waitFor(() => {
      expect(gitChangesPaneListBranchesIPC).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByPlaceholderText("Select branch..."), {
      target: { value: "dev" },
    });
    expect(screen.queryByRole("option", { name: /feature/i })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /origin\/dev/i }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cmd_git_checkout", {
        repo: "/tmp/work/arris",
        branch: "dev",
      });
    });
  });

  it("filters worktrees by name and branch", async () => {
    useGitStore.setState({ isWorktreePickerOpen: true });
    render(<TopBar />);
    await waitFor(() => {
      expect(gitChangesPaneWorktreeListIPC).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByPlaceholderText("Select a worktree..."), {
      target: { value: "min-82" },
    });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("arris-min-82");
  });

  it("shows a delete button only for non-current local branches", async () => {
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: /git branch: main/i }));
    await waitFor(() => {
      expect(gitChangesPaneListBranchesIPC).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: /delete branch feature/i })).not.toBeNull();
    // The current branch and remote branches are not deletable from here.
    expect(screen.queryByRole("button", { name: /delete branch main/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete branch origin\/dev/i })).toBeNull();
  });

  it("deletes a branch with a safe (non-forced) delete first", async () => {
    render(<TopBar />);
    fireEvent.click(screen.getByRole("button", { name: /git branch: main/i }));
    await waitFor(() => {
      expect(gitChangesPaneListBranchesIPC).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: /delete branch feature/i }));
    await waitFor(() => {
      expect(gitChangesPaneDeleteBranchIPC).toHaveBeenCalledWith(
        "/tmp/work/arris",
        "feature",
        false,
      );
    });
  });

  it("shows a remove button only for non-main, non-current worktrees", async () => {
    useGitStore.setState({ isWorktreePickerOpen: true });
    render(<TopBar />);
    await waitFor(() => {
      expect(gitChangesPaneWorktreeListIPC).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: /remove worktree arris-min-82/i })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /remove worktree main worktree/i })).toBeNull();
  });

  it("removes a worktree with a safe (non-forced) remove first", async () => {
    useGitStore.setState({ isWorktreePickerOpen: true });
    render(<TopBar />);
    await waitFor(() => {
      expect(gitChangesPaneWorktreeListIPC).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: /remove worktree arris-min-82/i }));
    await waitFor(() => {
      expect(gitChangesPaneRemoveWorktreeIPC).toHaveBeenCalledWith(
        "/tmp/work/arris",
        "/tmp/work/arris-min-82",
        false,
      );
    });
  });
});
