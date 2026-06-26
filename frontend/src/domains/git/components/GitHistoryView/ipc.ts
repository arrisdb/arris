import { invoke } from "@tauri-apps/api/core";
import type { CommitGraphRow } from "./types";

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

interface RemoteInfo {
  name: string;
  url: string;
}

function gitHistoryCommitGraphIPC(
  repo: string,
  limit: number,
): Promise<CommitGraphRow[]> {
  return invoke("cmd_git_commit_graph", { repo, limit });
}

function gitHistorySearchIPC(
  repo: string,
  query: string,
  limit: number,
): Promise<CommitGraphRow[]> {
  return invoke("cmd_git_search_commits", { repo, query, limit });
}

function gitHistoryCommitDetailIPC(
  repo: string,
  commit: string,
): Promise<CommitDetail> {
  return invoke("cmd_git_commit_detail", { repo, commit });
}

function gitHistoryListRemotesIPC(repo: string): Promise<RemoteInfo[]> {
  return invoke("cmd_git_list_remotes", { repo });
}

export {
  gitHistoryCommitDetailIPC,
  gitHistoryCommitGraphIPC,
  gitHistoryListRemotesIPC,
  gitHistorySearchIPC,
};
export type { CommitDetail, CommitFileChange, RemoteInfo };
