import type { RefObject } from "react";
import type {
  BranchInfo,
  WorktreeInfo,
} from "@shared";
import type { TOP_BAR_TABS } from "./constants";

type TopBarTab = (typeof TOP_BAR_TABS)[keyof typeof TOP_BAR_TABS];

interface TopBarViewModel {
  activeTab: TopBarTab;
  branchFilter: string;
  branchName: string;
  branchPickerRef: RefObject<HTMLDivElement>;
  busyBranch: string | null;
  canSwitchBranch: boolean;
  currentBranch: string | null;
  error: string | null;
  filteredBranches: BranchInfo[];
  filteredWorktrees: WorktreeInfo[];
  isBranchPickerOpen: boolean;
  isWorktreePickerOpen: boolean;
  onBranchFilterChange: (value: string) => void;
  onCheckoutBranch: (name: string) => void;
  onClickBranchesTab: () => void;
  onClickDeleteBranch: (name: string) => void;
  onClickRemoveWorktree: (path: string) => void;
  onClickStashTab: () => void;
  onClickToggleBranchPicker: () => void;
  onClickToggleWorktreePicker: () => void;
  onWorktreeFilterChange: (value: string) => void;
  projectName: string;
  repoPath: string | null;
  worktreeFilter: string;
  worktreePickerRef: RefObject<HTMLDivElement>;
  worktreeLabel: string | null;
}

export type {
  TopBarTab,
  TopBarViewModel,
};
