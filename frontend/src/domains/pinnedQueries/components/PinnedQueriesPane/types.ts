import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import type { PaneContextMenuItems } from "@shared/ui/ContextMenu";
import type { DatabaseKind } from "@shared";

interface PinnedQuery {
  id: string;
  name: string;
  text: string;
  connectionId?: string;
  kind: string;
}

interface PinnedQueriesState {
  queries: PinnedQuery[];
  paneOpen: boolean;
  addQuery: (query: Omit<PinnedQuery, "id">) => string;
  removeQuery: (id: string) => void;
  patchQuery: (id: string, patch: Partial<PinnedQuery>) => void;
  setQueries: (queries: PinnedQuery[]) => void;
  togglePane: () => void;
  openPane: () => void;
  closePane: () => void;
  hydrate: () => Promise<void>;
  persist: () => Promise<void>;
}

interface PinnedQueriesPaneViewModel {
  queries: PinnedQuery[];
  copiedId: string | null;
  renamingId: string | null;
  renameDraft: string;
  onCancelRename: () => void;
  onChangeRenameDraft: (value: string) => void;
  onCommitRename: (queryId: string) => void;
  onCopyQuery: (queryId: string) => void;
  onDoubleClickQuery: (queryId: string) => void;
  onRemoveQuery: (queryId: string) => void;
  onStartRename: (queryId: string) => void;
}

interface PinnedQueryRowProps {
  query: PinnedQuery;
  copied: boolean;
  isRenaming: boolean;
  renameDraft: string;
  onCancelRename: () => void;
  onChangeRenameDraft: (value: string) => void;
  onCommitRename: (queryId: string) => void;
  onCopyQuery: (queryId: string) => void;
  onDoubleClickQuery: (queryId: string) => void;
  onRemoveQuery: (queryId: string) => void;
  onStartRename: (queryId: string) => void;
}

interface PinnedQueryRenameInputProps {
  queryId: string;
  renameDraft: string;
  onCancelRename: () => void;
  onChangeRenameDraft: (value: string) => void;
  onCommitRename: (queryId: string) => void;
}

type PinnedQueriesContextMenuItems = PaneContextMenuItems<null>;

type PinnedQueryButtonEvent = ReactMouseEvent<HTMLButtonElement>;

type PinnedQueryRenameKeyEvent = ReactKeyboardEvent<HTMLInputElement>;

export type {
  DatabaseKind,
  PinnedQueriesContextMenuItems,
  PinnedQueriesPaneViewModel,
  PinnedQueriesState,
  PinnedQuery,
  PinnedQueryButtonEvent,
  PinnedQueryRenameInputProps,
  PinnedQueryRenameKeyEvent,
  PinnedQueryRowProps,
};
