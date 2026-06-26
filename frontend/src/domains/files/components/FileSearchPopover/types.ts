import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from "react";

type SearchMode = "file" | "content";

interface FileMatch {
  path: string;
  filename: string;
  score: number;
}

interface ContentMatch {
  path: string;
  filename: string;
  lineNum: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

interface FileSearchPopoverViewModel {
  contentResults: ContentMatch[];
  fileResults: FileMatch[];
  inputRef: RefObject<HTMLInputElement>;
  listRef: RefObject<HTMLDivElement>;
  loading: boolean;
  mode: SearchMode;
  onClickBackdrop: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onClickContentResult: (index: number) => void;
  onClickFileMode: () => void;
  onClickFileResult: (index: number) => void;
  onClickContentMode: () => void;
  onChange: (value: string) => void;
  onKeyDownDialog: (event: ReactKeyboardEvent) => void;
  open: boolean;
  query: string;
  results: Array<FileMatch | ContentMatch>;
  selectedIndex: number;
}

interface FileResultRowProps {
  match: FileMatch;
  onClick: () => void;
  selected: boolean;
}

interface ContentResultRowProps {
  match: ContentMatch;
  onClick: () => void;
  selected: boolean;
}

type FileSearchRowStyle = CSSProperties;

export type {
  ContentMatch,
  ContentResultRowProps,
  FileMatch,
  FileResultRowProps,
  FileSearchPopoverViewModel,
  FileSearchRowStyle,
  SearchMode,
};
