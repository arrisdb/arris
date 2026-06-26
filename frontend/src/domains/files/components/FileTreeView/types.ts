import type {
  CSSProperties,
  FocusEvent as ReactFocusEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import type { ContextMenuItem } from "@shared/ui/ContextMenu";

interface FileTreeEntry {
  name: string;
  path: string;
  isDir: boolean;
  gitIgnored?: boolean;
  children: FileTreeEntry[];
}

type ClipboardOp = "cut" | "copy" | null;
type CreatingType = "file" | "folder" | null;

interface FileTreeViewModel {
  contextMenuItems: ContextMenuItem[];
  ctxMenu: {
    state: { x: number; y: number; context: FileTreeEntry | null } | null;
    open: (event: ReactMouseEvent, context: FileTreeEntry | null) => void;
    close: () => void;
  };
  isLoading: boolean;
  loadError: string | null;
  onClickOpenFile: () => void;
  onClickOpenFolder: () => void;
  onContextMenuEmpty: (event: ReactMouseEvent) => void;
  onContextMenuRow: (event: ReactMouseEvent, node: FileTreeEntry) => void;
  onContextMenuTree: (event: ReactMouseEvent) => void;
  onKeyDownTree: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  statusMap: Map<string, string>;
  tree: FileTreeEntry | null;
}

interface FileTreeRowProps {
  depth: number;
  node: FileTreeEntry;
  onContextMenu: (event: ReactMouseEvent, node: FileTreeEntry) => void;
  statusMap: Map<string, string>;
}

interface FileTreeInlineCreateRowProps {
  depth: number;
  dirPath: string;
}

interface FileTreeInlineRenameProps {
  currentName: string;
  path: string;
}

interface FileTreeGlyphProps {
  expanded: boolean;
  node: FileTreeEntry;
}

interface FileTreeRowViewModel {
  expanded: boolean;
  gitStatus: string | undefined;
  isActiveFile: boolean;
  isRenaming: boolean;
  onClickRow: () => void;
  onPointerDownRow: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  rowClassName: string;
  rowStyle: CSSProperties;
}

interface FileTreeInlineCreateViewModel {
  inputRef: RefObject<HTMLInputElement>;
  isFolder: boolean;
  onBlurCreate: (event: ReactFocusEvent<HTMLInputElement>) => void;
  onClickCreateInput: (event: ReactMouseEvent<HTMLInputElement>) => void;
  onKeyDownCreate: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  visible: boolean;
}

interface FileTreeInlineRenameViewModel {
  inputRef: RefObject<HTMLInputElement>;
  onBlurRename: (event: ReactFocusEvent<HTMLInputElement>) => void;
  onClickRenameInput: (event: ReactMouseEvent<HTMLInputElement>) => void;
  onKeyDownRename: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
}

export type {
  ClipboardOp,
  CreatingType,
  FileTreeEntry,
  FileTreeGlyphProps,
  FileTreeInlineCreateRowProps,
  FileTreeInlineCreateViewModel,
  FileTreeInlineRenameProps,
  FileTreeInlineRenameViewModel,
  FileTreeRowProps,
  FileTreeRowViewModel,
  FileTreeViewModel,
};
