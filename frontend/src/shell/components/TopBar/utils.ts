import type { WorktreeInfo } from "@shared";
import {
  DEFAULT_PROJECT_NAME,
  MAIN_WORKTREE_LABEL,
  MAIN_WORKTREE_NAME,
  REMOTE_BRANCH_PREFIX,
} from "./constants";

function projectNameFromPath(path: string | null): string {
  if (!path) return DEFAULT_PROJECT_NAME;
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function worktreeLabel(name: string | null): string | null {
  if (!name) return null;
  if (name === MAIN_WORKTREE_NAME) return MAIN_WORKTREE_LABEL;
  return name;
}

function worktreeDisplayName(wt: WorktreeInfo): string {
  if (wt.isMain) return MAIN_WORKTREE_NAME;
  return wt.path.split(/[\\/]/).filter(Boolean).pop() || wt.path;
}

function branchCheckoutTarget(name: string): string {
  if (name.startsWith(REMOTE_BRANCH_PREFIX)) return name.slice(REMOTE_BRANCH_PREFIX.length);
  return name;
}

export {
  branchCheckoutTarget,
  projectNameFromPath,
  worktreeDisplayName,
  worktreeLabel,
};
