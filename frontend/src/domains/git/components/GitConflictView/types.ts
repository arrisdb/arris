/// Which side(s) of a conflict hunk the user accepted. `null` = unresolved.
type ConflictResolution = "ours" | "theirs" | "both" | null;

interface TextSegment {
  kind: "text";
  lines: string[];
}

interface ConflictHunkSegment {
  kind: "conflict";
  ours: string[];
  base: string[] | null;
  theirs: string[];
  resolution: ConflictResolution;
}

type ConflictSegment = TextSegment | ConflictHunkSegment;

interface MergeState {
  inProgress: boolean;
  /// "merge" | "rebase" | "none".
  kind: string;
  conflicted: string[];
}

interface GitConflictViewModel {
  hasRepo: boolean;
  mergeKind: string;
  conflictedFiles: string[];
  selectedFile: string | null;
  segments: ConflictSegment[];
  conflictCount: number;
  resolvedCount: number;
  allResolved: boolean;
  isBusy: boolean;
  error: string | null;
  onSelectFile: (path: string) => void;
  onAcceptHunk: (index: number, resolution: ConflictResolution) => void;
  onUseOurs: () => void;
  onUseTheirs: () => void;
  onMarkResolved: () => void;
  onContinue: () => void;
  onAbort: () => void;
}

export type {
  ConflictHunkSegment,
  ConflictResolution,
  ConflictSegment,
  GitConflictViewModel,
  MergeState,
  TextSegment,
};
