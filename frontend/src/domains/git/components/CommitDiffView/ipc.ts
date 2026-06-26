import { invoke } from "@tauri-apps/api/core";

interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

interface CommitFileChange {
  path: string;
  additions: number;
  deletions: number;
}

interface CommitDetail {
  id: string;
  summary: string;
  body: string;
  author: string;
  email: string;
  timestamp: number;
  additions: number;
  deletions: number;
  files: CommitFileChange[];
}

interface CommitFileDiff {
  path: string;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

function commitDetailIPC(repo: string, commit: string): Promise<CommitDetail> {
  return invoke("cmd_git_commit_detail", { repo, commit });
}

function commitDiffIPC(repo: string, commit: string): Promise<CommitFileDiff[]> {
  return invoke("cmd_git_commit_diff", { repo, commit });
}

export { commitDetailIPC, commitDiffIPC };
export type { CommitDetail, CommitFileChange, CommitFileDiff, DiffHunk, DiffLine };
