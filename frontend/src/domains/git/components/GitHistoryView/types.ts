import type { CommitDetail } from "./ipc";

interface CommitRef {
  name: string;
  /// "head" | "localBranch" | "remoteBranch" | "tag".
  kind: string;
}

interface GraphEdge {
  fromCol: number;
  toCol: number;
}

interface CommitGraphRow {
  id: string;
  parents: string[];
  summary: string;
  author: string;
  timestamp: number;
  refs: CommitRef[];
  column: number;
  edges: GraphEdge[];
}

interface GitHistoryViewModel {
  visibleRows: CommitGraphRow[];
  laneCount: number;
  query: string;
  isLoading: boolean;
  isLoadingMore: boolean;
  isSearching: boolean;
  hasMore: boolean;
  error: string | null;
  hasRepo: boolean;
  onChangeQuery: (value: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  /// Commit-detail panel: the selected commit's id, its loaded detail, and the
  /// "View on GitHub" URL (null when no usable remote). The panel is hidden
  /// when `selectedCommitId` is null.
  selectedCommitId: string | null;
  detail: CommitDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  detailWebUrl: string | null;
  onSelectCommit: (row: CommitGraphRow) => void;
  onCloseDetail: () => void;
  /// Open the per-commit diff tab focused on a single changed file.
  onOpenCommitFile: (path: string) => void;
  /// Open the per-commit diff tab for the whole commit ("View Commit").
  onViewCommit: () => void;
}

export type {
  CommitGraphRow,
  CommitRef,
  GitHistoryViewModel,
  GraphEdge,
};
