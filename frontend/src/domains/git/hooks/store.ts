import { create } from "zustand";
import { ipcErrorMessage } from "@shared";
import { readTextFileIPC } from "@shell/ipc";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { runNotifiedTask } from "@shell/utils/notifiedTask";
import {
  GIT_FETCH_DONE_MESSAGE,
  GIT_FORCE_PUSHED_MESSAGE,
  GIT_PULL_UP_TO_DATE_MESSAGE,
  GIT_PUSHED_MESSAGE,
  GIT_TASK_LABELS,
} from "../constants";
import {
  gitChangesPaneAheadBehindIPC,
  gitChangesPaneCommitIPC,
  gitChangesPaneCurrentBranchIPC,
  gitChangesPaneDeleteBranchIPC,
  gitChangesPaneDiscardFilesIPC,
  gitChangesPaneFetchIPC,
  gitChangesPaneFileDiffStatsIPC,
  gitChangesPaneFileStatusesIPC,
  gitChangesPaneForcePushIPC,
  gitChangesPaneLastCommitIPC,
  gitChangesPaneListBranchesIPC,
  gitChangesPaneListRemotesIPC,
  gitChangesPaneMergeStateIPC,
  gitChangesPanePullFromIPC,
  gitChangesPanePullIPC,
  gitChangesPanePushIPC,
  gitChangesPanePushToIPC,
  gitChangesPanePushStateIPC,
  gitChangesPaneRemoveWorktreeIPC,
  gitChangesPaneSetRemoteUrlIPC,
  gitChangesPaneStageAllIPC,
  gitChangesPaneStageFilesIPC,
  gitChangesPaneUnstageAllIPC,
  gitChangesPaneUnstageFilesIPC,
  gitChangesPaneWorktreeListIPC,
  gitChangesPaneWorktreeNameIPC,
} from "@domains/git/components/GitChangesPane/ipc";
import type { CommitInfo, FileStatus, GitBranch, MergeState, PushState, RemoteInfo, WorktreeInfo } from "@domains/git/components/GitChangesPane/types";

const NO_MERGE_STATE: MergeState = { inProgress: false, kind: "none", conflicted: [] };

const NO_PUSH_STATE: PushState = { hasRemote: false, hasUpstream: false };
import { buildDiffStatsMap } from "@domains/git/components/GitChangesPane/utils";

interface GitState {
  repoPath: string | null;
  worktreeName: string | null;
  worktrees: WorktreeInfo[];
  branches: GitBranch[];
  currentBranch: string | null;
  fileStatuses: FileStatus[];
  diffStats: Map<string, { added: number; deleted: number }>;
  selectedFile: string | null;
  commitMessage: string;
  lastCommit: CommitInfo | null;
  aheadBehind: [number, number];
  isPickerOpen: boolean;
  isWorktreePickerOpen: boolean;
  isLoading: boolean;
  isCommitting: boolean;
  isPushing: boolean;
  loadError: string | null;
  commitError: string | null;
  /// Raw output of the last push attempt (success or failure), kept only so
  /// the moved-remote banner can parse a new GitHub URL out of it; user-facing
  /// results surface through the app-level notification service.
  lastPushOutput: string | null;
  hasRemote: boolean;
  hasUpstream: boolean;
  remotes: RemoteInfo[];
  isFetching: boolean;
  isPulling: boolean;
  mergeInProgress: boolean;
  mergeKind: string;
  conflictedFiles: string[];
  setBranches: (branches: GitBranch[]) => void;
  setCurrent: (name: string | null) => void;
  deleteBranch: (name: string, force: boolean) => Promise<void>;
  removeWorktree: (path: string, force: boolean) => Promise<void>;
  openPicker: () => void;
  closePicker: () => void;
  openWorktreePicker: () => void;
  closeWorktreePicker: () => void;
  selectFile: (path: string | null) => void;
  setCommitMessage: (msg: string) => void;
  clear: () => void;
  refreshFromRepo: (repoPath: string) => Promise<void>;
  refreshFileStatuses: () => Promise<void>;
  stageFiles: (paths: string[]) => Promise<void>;
  unstageFiles: (paths: string[]) => Promise<void>;
  discardFiles: (paths: string[]) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  commit: () => Promise<void>;
  push: () => Promise<void>;
  pushTo: (remote: string, branch: string) => Promise<void>;
  forcePush: () => Promise<void>;
  fetch: () => Promise<void>;
  pull: () => Promise<void>;
  pullFrom: (remote: string, branch: string) => Promise<void>;
  refreshMergeState: () => Promise<void>;
  loadRemotes: () => Promise<void>;
  setRemoteUrl: (name: string, url: string) => Promise<void>;
}

const useGitStore = create<GitState>((set, get) => ({
  repoPath: null,
  worktreeName: null,
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
  isFetching: false,
  isPulling: false,
  mergeInProgress: false,
  mergeKind: "none",
  conflictedFiles: [],
  clear: () =>
    set({
      repoPath: null,
      worktreeName: null,
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
      isFetching: false,
      isPulling: false,
      mergeInProgress: false,
      mergeKind: "none",
      conflictedFiles: [],
    }),

  setBranches: (branches) => set({ branches }),
  setCurrent: (currentBranch) => set({ currentBranch }),
  deleteBranch: async (name, force) => {
    const { repoPath } = get();
    if (!repoPath) return;
    // Let the IPC rejection propagate so the caller can offer a forced retry.
    await gitChangesPaneDeleteBranchIPC(repoPath, name, force);
    await get().refreshFromRepo(repoPath);
  },
  removeWorktree: async (path, force) => {
    const { repoPath } = get();
    if (!repoPath) return;
    await gitChangesPaneRemoveWorktreeIPC(repoPath, path, force);
    await get().refreshFromRepo(repoPath);
  },
  openPicker: () => set({ isPickerOpen: true }),
  closePicker: () => set({ isPickerOpen: false }),
  openWorktreePicker: () => set({ isWorktreePickerOpen: true }),
  closeWorktreePicker: () => set({ isWorktreePickerOpen: false }),
  selectFile: (selectedFile) => set({ selectedFile }),
  setCommitMessage: (commitMessage) => set({ commitMessage }),
  refreshFromRepo: async (repoPath) => {
    set({ isLoading: true, loadError: null, repoPath });
    try {
      const [current, branches, statuses, lastCommitResult, ab, stats, wtName, wtList, pushState, remotes] =
        await Promise.all([
          gitChangesPaneCurrentBranchIPC(repoPath),
          gitChangesPaneListBranchesIPC(repoPath),
          gitChangesPaneFileStatusesIPC(repoPath).catch(() => []),
          gitChangesPaneLastCommitIPC(repoPath).catch(() => null),
          gitChangesPaneAheadBehindIPC(repoPath).catch((): [number, number] => [0, 0]),
          gitChangesPaneFileDiffStatsIPC(repoPath).catch((): [string, number, number][] => []),
          gitChangesPaneWorktreeNameIPC(repoPath).catch(() => null),
          gitChangesPaneWorktreeListIPC(repoPath).catch((): WorktreeInfo[] => []),
          gitChangesPanePushStateIPC(repoPath).catch(() => NO_PUSH_STATE),
          gitChangesPaneListRemotesIPC(repoPath).catch((): RemoteInfo[] => []),
        ]);
      const dsMap = buildDiffStatsMap(stats);
      set({
        worktreeName: wtName,
        worktrees: wtList,
        currentBranch: current ?? null,
        branches: branches.map((b) => ({
          name: b.name,
          isCurrent: b.isCurrent,
          isRemote: b.isRemote,
          upstream: b.upstream,
        })),
        fileStatuses: statuses,
        diffStats: dsMap,
        lastCommit: lastCommitResult,
        aheadBehind: ab,
        hasRemote: pushState.hasRemote,
        hasUpstream: pushState.hasUpstream,
        remotes,
        isLoading: false,
      });
      void get().refreshMergeState();
    } catch (e) {
      set({ isLoading: false, loadError: ipcErrorMessage(e) });
    }
  },
  refreshFileStatuses: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    try {
      const [current, statuses, ab, stats, pushState] = await Promise.all([
        gitChangesPaneCurrentBranchIPC(repoPath),
        gitChangesPaneFileStatusesIPC(repoPath),
        gitChangesPaneAheadBehindIPC(repoPath).catch((): [number, number] => [0, 0]),
        gitChangesPaneFileDiffStatsIPC(repoPath).catch((): [string, number, number][] => []),
        gitChangesPanePushStateIPC(repoPath).catch(() => NO_PUSH_STATE),
      ]);
      const dsMap = buildDiffStatsMap(stats);
      set({
        currentBranch: current ?? null,
        fileStatuses: statuses,
        aheadBehind: ab,
        diffStats: dsMap,
        hasRemote: pushState.hasRemote,
        hasUpstream: pushState.hasUpstream,
      });
      void get().refreshMergeState();
    } catch (_) {}
  },
  stageFiles: async (paths) => {
    const { repoPath } = get();
    if (!repoPath) return;
    await gitChangesPaneStageFilesIPC(repoPath, paths);
    await get().refreshFileStatuses();
  },
  unstageFiles: async (paths) => {
    const { repoPath } = get();
    if (!repoPath) return;
    await gitChangesPaneUnstageFilesIPC(repoPath, paths);
    await get().refreshFileStatuses();
  },
  discardFiles: async (paths) => {
    const { repoPath } = get();
    if (!repoPath) return;
    await gitChangesPaneDiscardFilesIPC(repoPath, paths);
    await get().refreshFileStatuses();
    // The on-disk files were reset to HEAD, but any open editor tab still
    // holds its discarded buffer in memory, so reload those tabs from disk so
    // the change doesn't reappear (and isn't re-saved) when the user returns.
    const discarded = new Set(paths);
    const tabsStore = useTabsStore.getState();
    await Promise.all(
      tabsStore.tabs
        .filter((tab) => tab.filePath && discarded.has(tab.filePath))
        .map(async (tab) => {
          const text = await readTextFileIPC(tab.filePath!).catch(() => null);
          if (text !== null) {
            tabsStore.updateTab(tab.id, { text, refreshToken: (tab.refreshToken ?? 0) + 1 });
          }
        }),
    );
  },
  stageAll: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    await gitChangesPaneStageAllIPC(repoPath);
    await get().refreshFileStatuses();
  },
  unstageAll: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    await gitChangesPaneUnstageAllIPC(repoPath);
    await get().refreshFileStatuses();
  },
  commit: async () => {
    const { repoPath, commitMessage } = get();
    if (!repoPath || !commitMessage.trim()) return;
    set({ isCommitting: true, commitError: null });
    try {
      const info = await gitChangesPaneCommitIPC(repoPath, commitMessage.trim());
      set({ isCommitting: false, commitMessage: "", lastCommit: info });
      await get().refreshFileStatuses();
    } catch (e) {
      set({ isCommitting: false, commitError: ipcErrorMessage(e) });
    }
  },
  push: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ isPushing: true });
    const result = await runNotifiedTask(GIT_TASK_LABELS.push, async () => {
      const message = await gitChangesPanePushIPC(repoPath);
      return message.trim() || GIT_PUSHED_MESSAGE;
    });
    set({ isPushing: false, lastPushOutput: result.message });
    const [ab, pushState] = await Promise.all([
      gitChangesPaneAheadBehindIPC(repoPath).catch((): [number, number] => [0, 0]),
      gitChangesPanePushStateIPC(repoPath).catch(() => NO_PUSH_STATE),
    ]);
    set({ aheadBehind: ab, hasRemote: pushState.hasRemote, hasUpstream: pushState.hasUpstream });
  },
  pushTo: async (remote, branch) => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ isPushing: true });
    const result = await runNotifiedTask(GIT_TASK_LABELS.push, async () => {
      const message = await gitChangesPanePushToIPC(repoPath, remote, branch);
      return message.trim() || GIT_PUSHED_MESSAGE;
    });
    set({ isPushing: false, lastPushOutput: result.message });
    const [ab, pushState] = await Promise.all([
      gitChangesPaneAheadBehindIPC(repoPath).catch((): [number, number] => [0, 0]),
      gitChangesPanePushStateIPC(repoPath).catch(() => NO_PUSH_STATE),
    ]);
    set({ aheadBehind: ab, hasRemote: pushState.hasRemote, hasUpstream: pushState.hasUpstream });
  },
  forcePush: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ isPushing: true });
    const result = await runNotifiedTask(GIT_TASK_LABELS.forcePush, async () => {
      const message = await gitChangesPaneForcePushIPC(repoPath);
      return message.trim() || GIT_FORCE_PUSHED_MESSAGE;
    });
    set({ isPushing: false, lastPushOutput: result.message });
    const [ab, pushState] = await Promise.all([
      gitChangesPaneAheadBehindIPC(repoPath).catch((): [number, number] => [0, 0]),
      gitChangesPanePushStateIPC(repoPath).catch(() => NO_PUSH_STATE),
    ]);
    set({ aheadBehind: ab, hasRemote: pushState.hasRemote, hasUpstream: pushState.hasUpstream });
  },
  fetch: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ isFetching: true });
    const result = await runNotifiedTask(GIT_TASK_LABELS.fetch, async () => {
      const message = await gitChangesPaneFetchIPC(repoPath);
      return message.trim() || GIT_FETCH_DONE_MESSAGE;
    });
    set({ isFetching: false });
    if (result.ok) await get().refreshFileStatuses();
  },
  pull: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ isPulling: true });
    let conflicted: string[] = [];
    const result = await runNotifiedTask(GIT_TASK_LABELS.pull, async () => {
      const pullResult = await gitChangesPanePullIPC(repoPath, "merge");
      conflicted = pullResult.conflicted;
      return pullResult.message || GIT_PULL_UP_TO_DATE_MESSAGE;
    });
    set({ isPulling: false, conflictedFiles: conflicted });
    if (!result.ok) return;
    await get().refreshFileStatuses();
    await get().refreshMergeState();
    // Conflicts halt the pull: surface the resolver immediately.
    if (conflicted.length > 0) {
      useTabsStore.getState().openGitConflictTab();
    }
  },
  pullFrom: async (remote, branch) => {
    const { repoPath } = get();
    if (!repoPath) return;
    set({ isPulling: true });
    let conflicted: string[] = [];
    const result = await runNotifiedTask(GIT_TASK_LABELS.pull, async () => {
      const pullResult = await gitChangesPanePullFromIPC(repoPath, remote, branch, "merge");
      conflicted = pullResult.conflicted;
      return pullResult.message || GIT_PULL_UP_TO_DATE_MESSAGE;
    });
    set({ isPulling: false, conflictedFiles: conflicted });
    if (!result.ok) return;
    await get().refreshFileStatuses();
    await get().refreshMergeState();
    if (conflicted.length > 0) {
      useTabsStore.getState().openGitConflictTab();
    }
  },
  refreshMergeState: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    const state = await gitChangesPaneMergeStateIPC(repoPath).catch(() => NO_MERGE_STATE);
    set({
      mergeInProgress: state.inProgress,
      mergeKind: state.kind,
      conflictedFiles: state.conflicted,
    });
  },
  loadRemotes: async () => {
    const { repoPath } = get();
    if (!repoPath) return;
    const remotes = await gitChangesPaneListRemotesIPC(repoPath).catch((): RemoteInfo[] => []);
    set({ remotes });
  },
  setRemoteUrl: async (name, url) => {
    const { repoPath } = get();
    if (!repoPath || !url.trim()) return;
    await gitChangesPaneSetRemoteUrlIPC(repoPath, name, url.trim());
    // The stale-remote push output no longer applies once the URL is fixed.
    set({ lastPushOutput: null });
    const [remotes, pushState] = await Promise.all([
      gitChangesPaneListRemotesIPC(repoPath).catch((): RemoteInfo[] => []),
      gitChangesPanePushStateIPC(repoPath).catch(() => NO_PUSH_STATE),
    ]);
    set({ remotes, hasRemote: pushState.hasRemote, hasUpstream: pushState.hasUpstream });
  },
}));

export {
  useGitStore,
};
