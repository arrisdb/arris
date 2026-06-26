import { invoke } from "@tauri-apps/api/core";
import type {
  BranchInfo,
  CommitInfo,
  FileStatus,
  MergeState,
  PullMode,
  PushState,
  RemoteInfo,
  SyncResult,
  WorktreeInfo,
} from "./types";

function gitChangesPaneWorktreeNameIPC(repo: string): Promise<string> {
  return invoke("cmd_git_worktree_name", { repo });
}

function gitChangesPaneWorktreeListIPC(repo: string): Promise<WorktreeInfo[]> {
  return invoke("cmd_git_worktree_list", { repo });
}

function gitChangesPaneCurrentBranchIPC(repo: string): Promise<string | null> {
  return invoke("cmd_git_current_branch", { repo });
}

function gitChangesPaneListBranchesIPC(repo: string): Promise<BranchInfo[]> {
  return invoke("cmd_git_list_branches", { repo });
}

function gitChangesPaneDeleteBranchIPC(
  repo: string,
  branch: string,
  force: boolean,
): Promise<void> {
  return invoke("cmd_git_delete_branch", { repo, branch, force });
}

function gitChangesPaneRemoveWorktreeIPC(
  repo: string,
  worktreePath: string,
  force: boolean,
): Promise<void> {
  return invoke("cmd_git_remove_worktree", { repo, worktreePath, force });
}

function gitChangesPaneFileStatusesIPC(repo: string): Promise<FileStatus[]> {
  return invoke("cmd_git_file_statuses", { repo });
}

function gitChangesPaneStageFilesIPC(repo: string, paths: string[]): Promise<void> {
  return invoke("cmd_git_stage_files", { repo, paths });
}

function gitChangesPaneUnstageFilesIPC(repo: string, paths: string[]): Promise<void> {
  return invoke("cmd_git_unstage_files", { repo, paths });
}

function gitChangesPaneDiscardFilesIPC(repo: string, paths: string[]): Promise<void> {
  return invoke("cmd_git_discard_files", { repo, paths });
}

function gitChangesPaneStageAllIPC(repo: string): Promise<void> {
  return invoke("cmd_git_stage_all", { repo });
}

function gitChangesPaneUnstageAllIPC(repo: string): Promise<void> {
  return invoke("cmd_git_unstage_all", { repo });
}

function gitChangesPaneCommitIPC(
  repo: string,
  message: string,
): Promise<CommitInfo> {
  return invoke("cmd_git_commit", { repo, message });
}

function gitChangesPanePushIPC(repo: string): Promise<string> {
  return invoke("cmd_git_push", { repo });
}

function gitChangesPanePushStateIPC(repo: string): Promise<PushState> {
  return invoke("cmd_git_push_state", { repo });
}

function gitChangesPaneLastCommitIPC(repo: string): Promise<CommitInfo> {
  return invoke("cmd_git_last_commit", { repo });
}

function gitChangesPaneAheadBehindIPC(repo: string): Promise<[number, number]> {
  return invoke("cmd_git_ahead_behind", { repo });
}

function gitChangesPaneFileDiffStatsIPC(
  repo: string,
): Promise<[string, number, number][]> {
  return invoke("cmd_git_file_diff_stats", { repo });
}

function gitChangesPaneListRemotesIPC(repo: string): Promise<RemoteInfo[]> {
  return invoke("cmd_git_list_remotes", { repo });
}

function gitChangesPaneSetRemoteUrlIPC(
  repo: string,
  name: string,
  url: string,
): Promise<void> {
  return invoke("cmd_git_set_remote_url", { repo, name, url });
}

function gitChangesPaneFetchIPC(repo: string): Promise<string> {
  return invoke("cmd_git_fetch", { repo });
}

function gitChangesPanePullIPC(repo: string, mode: PullMode): Promise<SyncResult> {
  return invoke("cmd_git_pull", { repo, mode });
}

function gitChangesPanePullFromIPC(
  repo: string,
  remote: string,
  branch: string,
  mode: PullMode,
): Promise<SyncResult> {
  return invoke("cmd_git_pull_from", { repo, remote, branch, mode });
}

function gitChangesPanePushToIPC(
  repo: string,
  remote: string,
  branch: string,
): Promise<string> {
  return invoke("cmd_git_push_to", { repo, remote, branch });
}

function gitChangesPaneForcePushIPC(repo: string): Promise<string> {
  return invoke("cmd_git_force_push", { repo });
}

function gitChangesPaneMergeStateIPC(repo: string): Promise<MergeState> {
  return invoke("cmd_git_merge_state", { repo });
}

export {
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
};
