import { useState } from "react";
import { useProjectStore } from "@shell/hooks/projectStore";
import { useRecentsStore } from "@shell/hooks/recentsStore";
import { openProjectInNewWindow, pickAndOpenFolderInNewWindow } from "@shell/utils/app";
import { OPEN_FOLDER_NEW_WINDOW_DIALOG_TITLE } from "./constants";
import {
  doScaffoldAndOpen,
  joinProjectPath,
  pickAndOpenFolder,
} from "./utils";
import {
  welcomeGitCloneIPC,
  welcomeListFolderTreeIPC,
} from "./ipc";
import type {
  PendingNewProject,
  PendingScaffold,
  ProjectKind,
  WelcomeScreenViewModel,
} from "./types";

function useWelcomeScreen(): WelcomeScreenViewModel {
  const recents = useRecentsStore((state) => state.recents);
  const [pendingNewProject, setPendingNewProject] = useState<PendingNewProject | null>(null);
  const [pendingScaffold, setPendingScaffold] = useState<PendingScaffold | null>(null);
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  async function cloneAndOpen(url: string, dest: string) {
    setIsCloning(true);
    setCloneError(null);
    try {
      const clonedPath = await welcomeGitCloneIPC(url, dest);
      setShowCloneDialog(false);
      setIsCloning(false);
      useProjectStore.getState().openProject(clonedPath);
    } catch (e) {
      setIsCloning(false);
      setCloneError(String(e));
    }
  }

  // For scaffolded kinds, warn before writing into a folder that already has
  // content; otherwise create + open directly.
  async function proceedWithProject(kind: ProjectKind, path: string) {
    if (kind !== "empty") {
      // Emptiness check before scaffolding: skip nothing so hidden dirs still
      // count as existing content (don't scaffold over a folder that only has
      // node_modules, etc.).
      const tree = await welcomeListFolderTreeIPC(path, []).catch(() => null);
      if (tree && tree.children && tree.children.length > 0) {
        setPendingScaffold({ kind, path });
        return;
      }
    }
    await doScaffoldAndOpen(kind, path);
  }

  function onCancelCloneDialog() {
    setShowCloneDialog(false);
    setCloneError(null);
  }

  function onCancelNewProject() {
    setPendingNewProject(null);
  }

  function onCancelScaffold() {
    setPendingScaffold(null);
  }

  function onClickNewProject(kind: ProjectKind) {
    setPendingNewProject({ kind });
  }

  function onCreateNewProject(name: string, location: string) {
    if (!pendingNewProject) return;
    const { kind } = pendingNewProject;
    setPendingNewProject(null);
    proceedWithProject(kind, joinProjectPath(location, name)).catch(() => {});
  }

  function onClickOpenFolder() {
    pickAndOpenFolder().catch(() => {});
  }

  function onClickOpenFolderNewWindow() {
    pickAndOpenFolderInNewWindow(OPEN_FOLDER_NEW_WINDOW_DIALOG_TITLE).catch(() => {});
  }

  function onClickRecentProject(path: string) {
    useProjectStore.getState().openProject(path);
  }

  function onOpenRecentProjectNewWindow(path: string) {
    openProjectInNewWindow(path).catch(() => {});
  }

  function onClickShowCloneDialog() {
    setShowCloneDialog(true);
  }

  function onCloneSubmit(url: string, dest: string) {
    cloneAndOpen(url, dest).catch(() => {});
  }

  function onConfirmScaffold() {
    if (!pendingScaffold) return;
    const { kind, path } = pendingScaffold;
    setPendingScaffold(null);
    doScaffoldAndOpen(kind, path).catch(() => {});
  }

  return {
    cloneError,
    isCloning,
    onCancelCloneDialog,
    onCancelNewProject,
    onCancelScaffold,
    onClickNewProject,
    onClickOpenFolder,
    onClickOpenFolderNewWindow,
    onClickRecentProject,
    onClickShowCloneDialog,
    onCloneSubmit,
    onConfirmScaffold,
    onCreateNewProject,
    onOpenRecentProjectNewWindow,
    pendingNewProject,
    pendingScaffold,
    recents,
    showCloneDialog,
  };
}

export {
  useWelcomeScreen,
};
