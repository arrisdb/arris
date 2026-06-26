import { pathRelativeToRoot } from "../../utils/path";
import type { DirNode, FileStatus, GitDiffStat } from "./types";

function buildDiffStatsMap(
  stats: [string, number, number][],
): Map<string, GitDiffStat> {
  const diffStats = new Map<string, GitDiffStat>();
  for (const [path, added, deleted] of stats) {
    diffStats.set(path, { added, deleted });
  }
  return diffStats;
}

function buildTree(statuses: FileStatus[], repoRoot: string): DirNode {
  const root: DirNode = { name: "", path: repoRoot, children: [], files: [] };
  for (const status of statuses) {
    // git porcelain reports a wholly-untracked directory as a single entry with
    // a trailing slash (e.g. "models/"). Strip it so the entry becomes one clean
    // row instead of a phantom empty folder plus a blank-named child.
    const rel = pathRelativeToRoot(status.path, repoRoot).replace(/\/+$/, "");
    const parts = rel.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      let child = node.children.find((item) => item.name === dirName);
      if (!child) {
        child = {
          name: dirName,
          path: `${repoRoot}/${parts.slice(0, i + 1).join("/")}`,
          children: [],
          files: [],
        };
        node.children.push(child);
      }
      node = child;
    }
    node.files.push(status);
  }
  return root;
}

function gitStatusColor(status: string): string | undefined {
  switch (status) {
    case "M":
      return "rgba(255,217,96,0.85)";
    case "A":
      return "rgba(91,227,154,0.85)";
    case "D":
      return "rgba(255,107,107,0.85)";
    default:
      return undefined;
  }
}

function isStaged(status: FileStatus): boolean {
  return status.indexStatus !== " " && status.indexStatus !== "?";
}

// git porcelain marks a wholly-untracked directory with a trailing slash.
function isDirectoryEntry(path: string): boolean {
  return path.endsWith("/");
}

// Derive the display name from a change path, tolerant of the trailing slash on
// untracked-directory entries (which would otherwise yield an empty string).
function gitChangeFileName(path: string): string {
  const cleaned = path.replace(/\/+$/, "");
  return cleaned.split("/").pop() || cleaned;
}

// GitHub rejects pushes to a renamed/moved repo with:
//   "remote: This repository moved. Please use the new location:
//    remote:   https://github.com/owner/repo.git"
// Pull the suggested URL out so we can offer a one-click remote update.
function parseMovedRemoteUrl(message: string | null): string | null {
  if (!message || !/repository moved/i.test(message)) return null;
  const match = message.match(/new location:\s*(?:remote:\s*)?(\S+)/i);
  if (!match) return null;
  // Trim trailing sentence punctuation; ".git" URLs end in a letter so are safe.
  const url = match[1].trim().replace(/[.,)]+$/, "");
  return url || null;
}

// Parse a "Pull From" / "Push to" target string into a remote + branch. The
// user types `origin main` (or just `origin`, or leaves it blank); missing
// parts fall back to the repo defaults so the action always has a valid ref.
function parseRemoteBranchTarget(
  input: string,
  defaultRemote: string,
  defaultBranch: string,
): { remote: string; branch: string } {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  return {
    remote: parts[0] ?? defaultRemote,
    branch: parts[1] ?? defaultBranch,
  };
}

export {
  buildDiffStatsMap,
  buildTree,
  gitChangeFileName,
  gitStatusColor,
  isDirectoryEntry,
  isStaged,
  parseMovedRemoteUrl,
  parseRemoteBranchTarget,
};
