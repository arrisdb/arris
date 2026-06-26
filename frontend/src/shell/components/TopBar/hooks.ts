import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useProjectStore } from "@shell/hooks/projectStore";
import { useFilesStore } from "@domains/files/hooks";
import { useGitStore } from "@domains/git/hooks";
import { ipcErrorMessage } from "@shared";
import {
  DEFAULT_BRANCH_NAME,
  TOP_BAR_TABS,
} from "./constants";
import { topBarGitCheckoutIPC } from "./ipc";
import type {
  TopBarTab,
  TopBarViewModel,
} from "./types";
import {
  branchCheckoutTarget,
  projectNameFromPath,
  worktreeDisplayName,
  worktreeLabel as formatWorktreeLabel,
} from "./utils";

function usePopoverDismiss(
  isOpen: boolean,
  popoverRef: RefObject<HTMLDivElement>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && popoverRef.current?.contains(target)) return;
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose, popoverRef]);
}

function usePickerRefresh(isOpen: boolean, repoPath: string | null, refreshFromRepo: (repo: string) => Promise<void>) {
  useEffect(() => {
    if (!isOpen || !repoPath) return;
    refreshFromRepo(repoPath).catch(() => {});
  }, [isOpen, repoPath, refreshFromRepo]);
}

function useTopBar(): TopBarViewModel {
  const activeProjectPath = useProjectStore((state) => state.activeProjectPath);
  const rootPath = useFilesStore((state) => state.rootPath);
  const branches = useGitStore((state) => state.branches);
  const currentBranch = useGitStore((state) => state.currentBranch);
  const repoPath = useGitStore((state) => state.repoPath);
  const worktrees = useGitStore((state) => state.worktrees);
  const isBranchPickerOpen = useGitStore((state) => state.isPickerOpen);
  const openBranchPicker = useGitStore((state) => state.openPicker);
  const closeBranchPicker = useGitStore((state) => state.closePicker);
  const isWorktreePickerOpen = useGitStore((state) => state.isWorktreePickerOpen);
  const openWorktreePicker = useGitStore((state) => state.openWorktreePicker);
  const closeWorktreePicker = useGitStore((state) => state.closeWorktreePicker);
  const setCurrentBranch = useGitStore((state) => state.setCurrent);
  const refreshFromRepo = useGitStore((state) => state.refreshFromRepo);
  const deleteBranchAction = useGitStore((state) => state.deleteBranch);
  const removeWorktreeAction = useGitStore((state) => state.removeWorktree);
  const worktreeNameRaw = useGitStore((state) => state.worktreeName);

  const [branchFilter, setBranchFilter] = useState("");
  const [worktreeFilter, setWorktreeFilter] = useState("");
  const [activeTab, setActiveTab] = useState<TopBarTab>(TOP_BAR_TABS.branches);
  const [busyBranch, setBusyBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const branchPickerRef = useRef<HTMLDivElement | null>(null);
  const worktreePickerRef = useRef<HTMLDivElement | null>(null);

  const projectName = useMemo(
    () => projectNameFromPath(activeProjectPath ?? rootPath),
    [activeProjectPath, rootPath],
  );
  const branchName = currentBranch ?? DEFAULT_BRANCH_NAME;
  const topBarWorktreeLabel = useMemo(
    () => formatWorktreeLabel(worktreeNameRaw),
    [worktreeNameRaw],
  );
  const canSwitchBranch = Boolean(repoPath);

  const filteredBranches = useMemo(() => {
    const query = branchFilter.trim().toLowerCase();
    if (!query) return branches;
    return branches.filter((branch) => branch.name.toLowerCase().includes(query));
  }, [branches, branchFilter]);

  const filteredWorktrees = useMemo(() => {
    const query = worktreeFilter.trim().toLowerCase();
    if (!query) return worktrees;
    return worktrees.filter((worktree) => {
      const name = worktreeDisplayName(worktree).toLowerCase();
      const branch = (worktree.branch ?? "").toLowerCase();
      return name.includes(query) || branch.includes(query);
    });
  }, [worktrees, worktreeFilter]);

  useEffect(() => {
    if (!isBranchPickerOpen) return;
    setBranchFilter("");
    setActiveTab(TOP_BAR_TABS.branches);
    setError(null);
  }, [isBranchPickerOpen]);

  useEffect(() => {
    if (!isWorktreePickerOpen) return;
    setWorktreeFilter("");
  }, [isWorktreePickerOpen]);

  usePickerRefresh(isBranchPickerOpen, repoPath, refreshFromRepo);
  usePickerRefresh(isWorktreePickerOpen, repoPath, refreshFromRepo);
  usePopoverDismiss(isBranchPickerOpen, branchPickerRef, closeBranchPicker);
  usePopoverDismiss(isWorktreePickerOpen, worktreePickerRef, closeWorktreePicker);

  async function checkoutBranch(name: string) {
    if (!repoPath) {
      setError("No git repository detected.");
      return;
    }
    setBusyBranch(name);
    setError(null);
    try {
      const target = branchCheckoutTarget(name);
      await topBarGitCheckoutIPC(repoPath, target);
      setCurrentBranch(target);
      await refreshFromRepo(repoPath);
      closeBranchPicker();
    } catch (e) {
      setError(ipcErrorMessage(e));
    } finally {
      setBusyBranch(null);
    }
  }

  function onBranchFilterChange(value: string) {
    setBranchFilter(value);
  }

  function onCheckoutBranch(name: string) {
    checkoutBranch(name).catch(() => {});
  }

  // Safe delete first; if git refuses (e.g. a squash-merged branch reported as
  // "not fully merged"), explain why and force-delete only on confirmation.
  async function deleteBranch(name: string) {
    setError(null);
    try {
      await deleteBranchAction(name, false);
      return;
    } catch (e) {
      const confirmed = window.confirm(
        `Couldn't delete branch "${name}":\n\n${ipcErrorMessage(e)}\n\nForce delete anyway?`,
      );
      if (!confirmed) return;
    }
    try {
      await deleteBranchAction(name, true);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }

  // Safe remove first; if git refuses (e.g. the worktree has uncommitted or
  // untracked changes), explain why and force-remove only on confirmation.
  async function removeWorktree(path: string) {
    setError(null);
    try {
      await removeWorktreeAction(path, false);
      return;
    } catch (e) {
      const confirmed = window.confirm(
        `Couldn't remove worktree "${path}":\n\n${ipcErrorMessage(e)}\n\nForce remove anyway?`,
      );
      if (!confirmed) return;
    }
    try {
      await removeWorktreeAction(path, true);
    } catch (e) {
      setError(ipcErrorMessage(e));
    }
  }

  function onClickDeleteBranch(name: string) {
    deleteBranch(name).catch(() => {});
  }

  function onClickRemoveWorktree(path: string) {
    removeWorktree(path).catch(() => {});
  }

  function onClickBranchesTab() {
    setActiveTab(TOP_BAR_TABS.branches);
  }

  function onClickStashTab() {
    setActiveTab(TOP_BAR_TABS.stash);
  }

  function onClickToggleBranchPicker() {
    if (isBranchPickerOpen) {
      closeBranchPicker();
      return;
    }
    closeWorktreePicker();
    openBranchPicker();
  }

  function onClickToggleWorktreePicker() {
    if (isWorktreePickerOpen) {
      closeWorktreePicker();
      return;
    }
    closeBranchPicker();
    openWorktreePicker();
  }

  function onWorktreeFilterChange(value: string) {
    setWorktreeFilter(value);
  }

  return {
    activeTab,
    branchFilter,
    branchName,
    branchPickerRef,
    busyBranch,
    canSwitchBranch,
    currentBranch,
    error,
    filteredBranches,
    filteredWorktrees,
    isBranchPickerOpen,
    isWorktreePickerOpen,
    onBranchFilterChange,
    onCheckoutBranch,
    onClickBranchesTab,
    onClickDeleteBranch,
    onClickRemoveWorktree,
    onClickStashTab,
    onClickToggleBranchPicker,
    onClickToggleWorktreePicker,
    onWorktreeFilterChange,
    projectName,
    repoPath,
    worktreeFilter,
    worktreePickerRef,
    worktreeLabel: topBarWorktreeLabel,
  };
}

export {
  useTopBar,
};
