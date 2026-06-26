import type { EditorTab } from "@shell/types";
import type { FileDiff } from "../GitDiffView/types";
import type { CommitDetail } from "./ipc";

interface CommitDiffViewProps {
  activeTab: EditorTab;
}

interface CommitDiffViewModel {
  detail: CommitDetail | null;
  fileDiffs: FileDiff[];
  loading: boolean;
  error: string | null;
  repoPath: string;
  /// File path to scroll into view once the diffs load (the file the user
  /// clicked in the commit-detail panel); `undefined` when opened via "View
  /// Commit".
  focusPath?: string;
  onToggleCollapse: (index: number) => void;
}

export type { CommitDiffViewModel, CommitDiffViewProps };
