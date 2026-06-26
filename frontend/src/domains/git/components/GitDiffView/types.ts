import type { PaneContextMenuItems } from "@shared/ui/ContextMenu";

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

interface FileDiff {
  path: string;
  hunks: DiffHunk[];
  collapsed: boolean;
}

interface SidePair {
  oldLine: number | null;
  newLine: number | null;
  oldText: string;
  newText: string;
  kind: "ctx" | "add" | "del" | "mod";
}

interface DiffSection {
  startIdx: number;
  hunkIdx: number;
  gapBefore: number;
}

interface SideBySideDiff {
  pairs: SidePair[];
  sections: DiffSection[];
}

interface GitDiffViewViewModel {
  fileDiffs: FileDiff[];
  fileStatusesCount: number;
  loading: boolean;
  onToggleCollapse: (index: number) => void;
  repoPath: string;
}

interface DiffFileSectionProps {
  diff: FileDiff;
  repoRoot: string;
  onToggleCollapse: () => void;
}

type GitDiffContextMenuItems = PaneContextMenuItems<null>;

export type {
  DiffFileSectionProps,
  DiffHunk,
  DiffLine,
  DiffSection,
  FileDiff,
  GitDiffContextMenuItems,
  GitDiffViewViewModel,
  SideBySideDiff,
  SidePair,
};
