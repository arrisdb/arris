import { useFilesStore } from "../../hooks";
import { openFileInTab } from "../FileTreeView/utils";
import { fileSearchPopoverReadTextFileIPC } from "./ipc";
import { useFileSearchStore } from "../../hooks/fileSearchStore";
import type {
  ContentMatch,
  FileMatch,
  FileSearchRowStyle,
  SearchMode,
} from "./types";

function contentCursorOffset(text: string, lineNum: number): number {
  let cursorOffset = 0;
  const lines = text.split("\n");
  for (let index = 0; index < Math.min(lineNum - 1, lines.length); index++) {
    cursorOffset += lines[index].length + 1;
  }
  return cursorOffset;
}

function dirOfPath(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return "";
  return path.substring(0, idx);
}

function fileSearchResultStyle(selected: boolean, cssVariable: string): FileSearchRowStyle {
  return { [cssVariable]: selected ? "var(--m-bg-card-hover)" : "transparent" } as FileSearchRowStyle;
}

function fileSearchTabStyle(active: boolean): FileSearchRowStyle {
  return {
    "--mdbc-file-search-tab-border": active ? "2px solid var(--m-accent)" : "2px solid transparent",
    "--mdbc-file-search-tab-color": active ? "var(--m-fg)" : "var(--m-fg-secondary)",
    "--mdbc-file-search-tab-font-weight": active ? 600 : 400,
  } as FileSearchRowStyle;
}

function iconForFileKind(kind: string): "database" | "braces" | "fileText" | "file" {
  switch (kind) {
    case "sql":
      return "database";
    case "json":
      return "braces";
    case "markdown":
      return "fileText";
    default:
      return "file";
  }
}

async function openContentMatch(rootPath: string, match: ContentMatch): Promise<void> {
  const fullPath = `${rootPath}/${match.path}`;
  await openFileInTab({
    filePath: fullPath,
    title: match.filename,
    readText: () => fileSearchPopoverReadTextFileIPC(fullPath),
    cursorForText: (text) => contentCursorOffset(text, match.lineNum),
  });
}

async function openFileMatch(rootPath: string, match: FileMatch): Promise<void> {
  const fullPath = `${rootPath}/${match.path}`;
  await openFileInTab({
    filePath: fullPath,
    title: match.filename,
    readText: () => fileSearchPopoverReadTextFileIPC(fullPath),
  });
}

async function openSelectedSearchResult(): Promise<void> {
  const state = useFileSearchStore.getState();
  const rootPath = useFilesStore.getState().rootPath;
  if (!rootPath) return;
  try {
    if (state.mode === "file") {
      const match = state.fileResults[state.selectedIndex];
      if (match) await openFileMatch(rootPath, match);
    } else {
      const match = state.contentResults[state.selectedIndex];
      if (match) await openContentMatch(rootPath, match);
    }
  } catch {
    // Ignore read errors; search remains usable.
  }
  state.hide();
}

function resultsForMode(
  mode: SearchMode,
  fileResults: FileMatch[],
  contentResults: ContentMatch[],
): Array<FileMatch | ContentMatch> {
  return mode === "file" ? fileResults : contentResults;
}

export {
  dirOfPath,
  fileSearchResultStyle,
  fileSearchTabStyle,
  iconForFileKind,
  openSelectedSearchResult,
  resultsForMode,
};
