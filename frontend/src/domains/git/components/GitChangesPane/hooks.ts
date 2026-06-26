import { useCallback, useMemo } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useContextMenu, type ContextMenuItem } from "@shared/ui/ContextMenu";
import { useFilesStore } from "@domains/files/hooks";
import { useGitStore } from "../../hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { openPickedFile } from "@domains/files";
import type { FileStatus, GitChangesPaneViewModel } from "./types";
import { buildTree, isStaged, parseMovedRemoteUrl } from "./utils";

function useGitChangesPane(): GitChangesPaneViewModel {
  const fileStatuses = useGitStore((state) => state.fileStatuses);
  const selectedFile = useGitStore((state) => state.selectedFile);
  const selectFile = useGitStore((state) => state.selectFile);
  const commitMessage = useGitStore((state) => state.commitMessage);
  const setCommitMessage = useGitStore((state) => state.setCommitMessage);
  const commit = useGitStore((state) => state.commit);
  const push = useGitStore((state) => state.push);
  const pushTo = useGitStore((state) => state.pushTo);
  const forcePush = useGitStore((state) => state.forcePush);
  const stageFiles = useGitStore((state) => state.stageFiles);
  const unstageFiles = useGitStore((state) => state.unstageFiles);
  const discardFiles = useGitStore((state) => state.discardFiles);
  const stageAll = useGitStore((state) => state.stageAll);
  const unstageAll = useGitStore((state) => state.unstageAll);
  const isCommitting = useGitStore((state) => state.isCommitting);
  const isPushing = useGitStore((state) => state.isPushing);
  const lastCommit = useGitStore((state) => state.lastCommit);
  const aheadBehind = useGitStore((state) => state.aheadBehind);
  const hasRemote = useGitStore((state) => state.hasRemote);
  const hasUpstream = useGitStore((state) => state.hasUpstream);
  const pushError = useGitStore((state) => state.pushError);
  const pushMessage = useGitStore((state) => state.pushMessage);
  const remotes = useGitStore((state) => state.remotes);
  const setRemoteUrl = useGitStore((state) => state.setRemoteUrl);
  const currentBranch = useGitStore((state) => state.currentBranch);
  const diffStats = useGitStore((state) => state.diffStats);
  const fetch = useGitStore((state) => state.fetch);
  const pull = useGitStore((state) => state.pull);
  const pullFrom = useGitStore((state) => state.pullFrom);
  const isFetching = useGitStore((state) => state.isFetching);
  const isPulling = useGitStore((state) => state.isPulling);
  const syncMessage = useGitStore((state) => state.syncMessage);
  const syncError = useGitStore((state) => state.syncError);
  const mergeInProgress = useGitStore((state) => state.mergeInProgress);
  const mergeKind = useGitStore((state) => state.mergeKind);
  const conflictedFiles = useGitStore((state) => state.conflictedFiles);
  const repoPath = useFilesStore((state) => state.rootPath) ?? "";
  const projectName = repoPath.split("/").filter(Boolean).pop() ?? "repo";

  const tree = useMemo(
    () => buildTree(fileStatuses, repoPath),
    [fileStatuses, repoPath],
  );

  const onChangeCommitMessage = useCallback((value: string) => {
    setCommitMessage(value);
  }, [setCommitMessage]);

  const onClickCommit = useCallback(() => {
    commit();
  }, [commit]);

  const onClickPush = useCallback(() => {
    push();
  }, [push]);

  // GitHub returns the new URL when a repo was renamed/moved; the default remote
  // (origin if present) is the one to repoint.
  const movedRemoteUrl = parseMovedRemoteUrl(pushError ?? pushMessage);
  const defaultRemoteName =
    remotes.find((remote) => remote.name === "origin")?.name ?? remotes[0]?.name ?? "origin";

  const onClickApplyMovedRemote = useCallback(() => {
    if (!movedRemoteUrl) return;
    void setRemoteUrl(defaultRemoteName, movedRemoteUrl).then(() => push());
  }, [movedRemoteUrl, defaultRemoteName, setRemoteUrl, push]);

  const onSaveRemoteUrl = useCallback((name: string, url: string) => {
    void setRemoteUrl(name, url);
  }, [setRemoteUrl]);

  const onClickFetch = useCallback(() => {
    fetch();
  }, [fetch]);

  const onClickPull = useCallback(() => {
    pull();
  }, [pull]);

  const onPullFrom = useCallback((remote: string, branch: string) => {
    pullFrom(remote, branch);
  }, [pullFrom]);

  const onPushTo = useCallback((remote: string, branch: string) => {
    pushTo(remote, branch);
  }, [pushTo]);

  const onForcePush = useCallback(() => {
    forcePush();
  }, [forcePush]);

  const onClickShowHistory = useCallback(() => {
    useTabsStore.getState().openGitHistoryTab();
  }, []);

  // Clicking a changed file selects it AND surfaces the diff: the "Uncommitted
  // Changes" tab is ephemeral, so it may be closed when a file is clicked.
  const onSelectFile = useCallback((path: string) => {
    selectFile(path);
    useTabsStore.getState().openGitDiffTab();
  }, [selectFile]);

  const onClickResolveConflicts = useCallback(() => {
    useTabsStore.getState().openGitConflictTab();
  }, []);

  const onClickStageAll = useCallback(() => {
    stageAll();
  }, [stageAll]);

  const onClickUnstageAll = useCallback(() => {
    unstageAll();
  }, [unstageAll]);

  const onKeyDownCommitMessage = useCallback((
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      commit();
    }
  }, [commit]);

  const onToggleStage = useCallback((path: string, currentlyStaged: boolean) => {
    if (currentlyStaged) {
      unstageFiles([path]);
    } else {
      stageFiles([path]);
    }
  }, [stageFiles, unstageFiles]);

  const menu = useContextMenu<FileStatus>();

  const getFileMenuItems = useCallback((file: FileStatus): ContextMenuItem[] => {
    const staged = isStaged(file);
    const untracked = file.status === "?";
    const name = file.path.split("/").pop() ?? file.path;
    return [
      {
        id: "stage-toggle",
        label: staged ? "Unstage File" : "Stage File",
        testId: "git-ctx-stage",
        action: () => onToggleStage(file.path, staged),
      },
      {
        id: "discard",
        label: "Discard Changes",
        testId: "git-ctx-discard",
        disabled: untracked,
        action: () => {
          if (!confirm(`Discard all changes to "${name}"? This cannot be undone.`)) return;
          void discardFiles([file.path]);
        },
      },
      { kind: "separator", id: "git-ctx-sep" },
      {
        id: "open-file",
        label: "Open File",
        testId: "git-ctx-open",
        action: () => {
          void openPickedFile(file.path);
        },
      },
    ];
  }, [onToggleStage, discardFiles]);

  const stagedCount = fileStatuses.filter(isStaged).length;
  const [ahead] = aheadBehind;
  const pushLabel = !hasUpstream
    ? "Publish Branch"
    : ahead > 0
      ? `↑${ahead} Push`
      : "Push";
  // Push is idempotent ("Everything up-to-date" when nothing to send), so it
  // stays enabled whenever a remote exists; only a push in flight disables it.
  const pushDisabled = isPushing;

  return {
    ahead,
    commitMessage,
    contextMenuState: menu.state,
    currentBranch,
    diffStats,
    fileStatuses,
    getFileMenuItems,
    hasStagedFiles: stagedCount > 0,
    isCommitting,
    isPushing,
    lastCommit,
    onChangeCommitMessage,
    onCloseContextMenu: menu.close,
    onContextMenuFile: menu.open,
    onClickCommit,
    onClickPush,
    onClickFetch,
    onClickPull,
    onPullFrom,
    onPushTo,
    onForcePush,
    onClickShowHistory,
    onClickResolveConflicts,
    onClickStageAll,
    onClickUnstageAll,
    onKeyDownCommitMessage,
    onClickApplyMovedRemote,
    onSaveRemoteUrl,
    onSelectFile,
    onToggleStage,
    movedRemoteUrl,
    projectName,
    pushDisabled,
    pushError,
    pushLabel,
    pushMessage,
    hasUpstream,
    defaultRemote: defaultRemoteName,
    isFetching,
    isPulling,
    syncMessage,
    syncError,
    mergeInProgress,
    mergeKind,
    conflictedCount: conflictedFiles.length,
    remotes,
    selectedFile,
    showPush: hasRemote,
    showSync: hasRemote,
    tree,
  };
}

export { useGitChangesPane };
