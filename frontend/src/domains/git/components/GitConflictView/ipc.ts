import { invoke } from "@tauri-apps/api/core";
import type { MergeState } from "./types";

interface ConflictVersions {
  base: string | null;
  ours: string;
  theirs: string;
  merged: string;
}

function gitConflictMergeStateIPC(repo: string): Promise<MergeState> {
  return invoke("cmd_git_merge_state", { repo });
}

function gitConflictVersionsIPC(repo: string, filePath: string): Promise<ConflictVersions> {
  return invoke("cmd_git_conflict_versions", { repo, filePath });
}

function gitConflictResolveOursIPC(repo: string, filePath: string): Promise<void> {
  return invoke("cmd_git_resolve_ours", { repo, filePath });
}

function gitConflictResolveTheirsIPC(repo: string, filePath: string): Promise<void> {
  return invoke("cmd_git_resolve_theirs", { repo, filePath });
}

function gitConflictWriteResolvedIPC(
  repo: string,
  filePath: string,
  content: string,
): Promise<void> {
  return invoke("cmd_git_write_resolved", { repo, filePath, content });
}

function gitConflictMergeContinueIPC(repo: string): Promise<void> {
  return invoke("cmd_git_merge_continue", { repo });
}

function gitConflictMergeAbortIPC(repo: string): Promise<void> {
  return invoke("cmd_git_merge_abort", { repo });
}

export type { ConflictVersions };
export {
  gitConflictMergeAbortIPC,
  gitConflictMergeContinueIPC,
  gitConflictMergeStateIPC,
  gitConflictResolveOursIPC,
  gitConflictResolveTheirsIPC,
  gitConflictVersionsIPC,
  gitConflictWriteResolvedIPC,
};
