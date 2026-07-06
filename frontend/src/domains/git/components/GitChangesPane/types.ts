import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import type { ContextMenuItem, ContextMenuState } from "@shared/ui/ContextMenu";

interface BranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
}

interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
}

interface FileStatus {
  path: string;
  status: string;
  indexStatus: string;
  worktreeStatus: string;
}

interface CommitInfo {
  id: string;
  summary: string;
  author: string;
  timestamp: number;
}

interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
}

interface GitDiffStat {
  added: number;
  deleted: number;
}

interface PushState {
  hasRemote: boolean;
  hasUpstream: boolean;
}

interface RemoteInfo {
  name: string;
  url: string;
}

type PullMode = "merge" | "rebase";

interface SyncResult {
  message: string;
  conflicted: string[];
}

interface MergeState {
  inProgress: boolean;
  kind: string;
  conflicted: string[];
}

interface DirNode {
  name: string;
  path: string;
  children: DirNode[];
  files: FileStatus[];
}

interface GitChangesPaneViewModel {
  ahead: number;
  commitMessage: string;
  contextMenuState: ContextMenuState<FileStatus> | null;
  currentBranch: string | null;
  diffStats: Map<string, GitDiffStat>;
  fileStatuses: FileStatus[];
  getFileMenuItems: (file: FileStatus) => ContextMenuItem[];
  hasStagedFiles: boolean;
  isCommitting: boolean;
  isPushing: boolean;
  lastCommit: CommitInfo | null;
  onChangeCommitMessage: (value: string) => void;
  onCloseContextMenu: () => void;
  onContextMenuFile: (event: ReactMouseEvent, file: FileStatus) => void;
  onClickCommit: () => void;
  onClickPush: () => void;
  onClickFetch: () => void;
  onClickPull: () => void;
  onPullFrom: (remote: string, branch: string) => void;
  onPushTo: (remote: string, branch: string) => void;
  onForcePush: () => void;
  onClickShowHistory: () => void;
  onClickResolveConflicts: () => void;
  onClickStageAll: () => void;
  onClickUnstageAll: () => void;
  onKeyDownCommitMessage: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onClickApplyMovedRemote: () => void;
  onSaveRemoteUrl: (name: string, url: string) => void;
  onSelectFile: (path: string) => void;
  onToggleStage: (path: string, currentlyStaged: boolean) => void;
  movedRemoteUrl: string | null;
  pushDisabled: boolean;
  pushLabel: string;
  hasUpstream: boolean;
  defaultRemote: string;
  isFetching: boolean;
  isPulling: boolean;
  mergeInProgress: boolean;
  mergeKind: string;
  conflictedCount: number;
  remotes: RemoteInfo[];
  selectedFile: string | null;
  showPush: boolean;
  showSync: boolean;
  tree: DirNode;
}

interface RemotesEditorProps {
  remotes: RemoteInfo[];
  onSave: (name: string, url: string) => void;
}

interface DirRowProps {
  node: DirNode;
  depth: number;
  selectedFile: string | null;
  onSelect: (path: string) => void;
  diffStats: Map<string, GitDiffStat>;
  onToggleStage: (path: string, staged: boolean) => void;
  onContextMenu: (event: ReactMouseEvent, file: FileStatus) => void;
}

interface GitChangesPaneContentProps {
  pane: GitChangesPaneViewModel;
}

interface GitFileRowProps {
  childDepth: number;
  file: FileStatus;
  selected: boolean;
  stats: GitDiffStat | undefined;
  staged: boolean;
  onSelect: (path: string) => void;
  onToggleStage: (path: string, staged: boolean) => void;
  onContextMenu: (event: ReactMouseEvent, file: FileStatus) => void;
}

export type {
  BranchInfo,
  CommitInfo,
  DirNode,
  DirRowProps,
  FileStatus,
  GitBranch,
  GitChangesPaneContentProps,
  GitChangesPaneViewModel,
  GitDiffStat,
  GitFileRowProps,
  MergeState,
  PullMode,
  PushState,
  RemoteInfo,
  RemotesEditorProps,
  SyncResult,
  WorktreeInfo,
};
