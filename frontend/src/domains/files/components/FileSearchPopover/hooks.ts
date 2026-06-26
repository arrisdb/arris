import { useCallback, useEffect, useRef } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useFileSearchStore } from "../../hooks/fileSearchStore";
import type { FileSearchPopoverViewModel } from "./types";
import {
  openSelectedSearchResult,
  resultsForMode,
} from "./utils";

function useFileSearchPopover(): FileSearchPopoverViewModel {
  const open = useFileSearchStore((state) => state.open);
  const mode = useFileSearchStore((state) => state.mode);
  const query = useFileSearchStore((state) => state.query);
  const fileResults = useFileSearchStore((state) => state.fileResults);
  const contentResults = useFileSearchStore((state) => state.contentResults);
  const selectedIndex = useFileSearchStore((state) => state.selectedIndex);
  const loading = useFileSearchStore((state) => state.loading);
  const hide = useFileSearchStore((state) => state.hide);
  const setQuery = useFileSearchStore((state) => state.setQuery);
  const setMode = useFileSearchStore((state) => state.setMode);
  const selectNext = useFileSearchStore((state) => state.selectNext);
  const selectPrev = useFileSearchStore((state) => state.selectPrev);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const onClickContentMode = useCallback(() => {
    setMode("content");
  }, [setMode]);

  const onClickFileMode = useCallback(() => {
    setMode("file");
  }, [setMode]);

  const onClickContentResult = useCallback((index: number) => {
    useFileSearchStore.setState({ selectedIndex: index });
    openSelectedSearchResult().catch(() => {});
  }, []);

  const onClickFileResult = useCallback((index: number) => {
    useFileSearchStore.setState({ selectedIndex: index });
    openSelectedSearchResult().catch(() => {});
  }, []);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (!listRef.current) return;
    const element = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    element?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const onClickBackdrop = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) hide();
  }, [hide]);

  const onChange = useCallback((value: string) => {
    setQuery(value);
  }, [setQuery]);

  const onKeyDownDialog = useCallback((event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hide();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      selectNext();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      selectPrev();
    } else if (event.key === "Enter") {
      event.preventDefault();
      openSelectedSearchResult().catch(() => {});
    } else if (event.key === "Tab") {
      event.preventDefault();
      setMode(mode === "file" ? "content" : "file");
    }
  }, [hide, mode, selectNext, selectPrev, setMode]);

  return {
    contentResults,
    fileResults,
    inputRef,
    listRef,
    loading,
    mode,
    onClickBackdrop,
    onClickContentMode,
    onClickContentResult,
    onClickFileMode,
    onClickFileResult,
    onChange,
    onKeyDownDialog,
    open,
    query,
    results: resultsForMode(mode, fileResults, contentResults),
    selectedIndex,
  };
}

export { useFileSearchPopover };
