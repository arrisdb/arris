import type { RecentEntry } from "@shell/types";

type ProjectKind = "empty" | "dbt" | "sqlmesh";

interface PendingScaffold {
  kind: ProjectKind;
  path: string;
}

interface PendingNewProject {
  kind: ProjectKind;
}

interface NewProjectDialogProps {
  kind: ProjectKind;
  onCreate: (name: string, location: string) => void;
  onCancel: () => void;
}

interface CloneDialogProps {
  onClone: (url: string, dest: string) => void;
  onCancel: () => void;
  isCloning: boolean;
  error: string | null;
}

interface ConfirmDialogProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface WelcomeScreenViewModel {
  cloneError: string | null;
  isCloning: boolean;
  onCancelCloneDialog: () => void;
  onCancelNewProject: () => void;
  onCancelScaffold: () => void;
  onClickNewProject: (kind: ProjectKind) => void;
  onClickOpenFolder: () => void;
  onClickOpenFolderNewWindow: () => void;
  onClickRecentProject: (path: string) => void;
  onClickShowCloneDialog: () => void;
  onCloneSubmit: (url: string, dest: string) => void;
  onConfirmScaffold: () => void;
  onCreateNewProject: (name: string, location: string) => void;
  onOpenRecentProjectNewWindow: (path: string) => void;
  pendingNewProject: PendingNewProject | null;
  pendingScaffold: PendingScaffold | null;
  recents: RecentEntry[];
  showCloneDialog: boolean;
}

export type {
  CloneDialogProps,
  ConfirmDialogProps,
  NewProjectDialogProps,
  PendingNewProject,
  PendingScaffold,
  ProjectKind,
  WelcomeScreenViewModel,
};
