import type { ChangeEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useSettingsStore } from "@shared/settings";
import { mountEditor, type EditorHandle } from "@domains/editor/utils/ui/setup";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";
import { CSV_ROW_HEIGHT, CSV_ROW_OVERSCAN } from "./constants";
import type { CsvData, CsvViewMode } from "./types";
import { addRow, deleteRow, parseCsv, unparseCsv, updateCell, updateHeader } from "./utils";

function useCsvTableView(tab: EditorTab) {
  const [mode, setMode] = useState<CsvViewMode>("table");
  const updateTab = useTabsStore((s) => s.updateTab);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);

  const csvData = useMemo(() => parseCsv(tab.text), [tab.text]);

  const commitCsvData = useCallback(
    (next: CsvData) => {
      updateTab(tab.id, { text: unparseCsv(next) });
    },
    [tab.id, updateTab],
  );

  const onClickTableMode = useCallback(() => setMode("table"), []);
  const onClickRawMode = useCallback(() => setMode("raw"), []);
  const onClickAddRow = useCallback(() => commitCsvData(addRow(csvData)), [commitCsvData, csvData]);

  const onCellEdit = useCallback(
    (row: number, col: number, val: string) => commitCsvData(updateCell(csvData, row, col, val)),
    [commitCsvData, csvData],
  );

  const onHeaderEdit = useCallback(
    (col: number, val: string) => commitCsvData(updateHeader(csvData, col, val)),
    [commitCsvData, csvData],
  );

  const onDeleteRow = useCallback(
    (row: number) => commitCsvData(deleteRow(csvData, row)),
    [commitCsvData, csvData],
  );

  return {
    csvData,
    mode,
    onCellEdit,
    onClickAddRow,
    onClickRawMode,
    onClickTableMode,
    onDeleteRow,
    onHeaderEdit,
    editorFontSize,
  };
}

function useCsvTable(rowCount: number) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CSV_ROW_HEIGHT,
    overscan: CSV_ROW_OVERSCAN,
  });

  const onClickRow = useCallback((rowIndex: number) => setSelectedRow(rowIndex), []);

  return { onClickRow, parentRef, rowVirtualizer, selectedRow };
}

function useInlineEditCell(value: string, onCommit: (value: string) => void) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDoubleClickStartEdit = useCallback(() => {
    setDraft(value);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [value]);

  const commitDraft = useCallback(() => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  }, [draft, onCommit, value]);

  const onBlurCommit = useCallback(() => {
    if (editing) commitDraft();
  }, [commitDraft, editing]);

  const onChangeDraft = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
  }, []);

  const onKeyDownEdit = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") setEditing(false);
  }, []);

  return {
    draft,
    editing,
    inputRef,
    onBlurCommit,
    onChangeDraft,
    onDoubleClickStartEdit,
    onKeyDownEdit,
  };
}

function useCsvRawEditor(tab: EditorTab, fontSize: number) {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorHandleRef = useRef<EditorHandle | null>(null);
  const updateTab = useTabsStore((s) => s.updateTab);

  const onEditRaw = useCallback(
    (patch: { text?: string; cursor?: number }) => updateTab(tab.id, patch),
    [tab.id, updateTab],
  );

  useEffect(() => {
    if (!editorHostRef.current) return;
    const handle = mountEditor({
      host: editorHostRef.current,
      initialDoc: tab.text,
      initialCursor: tab.cursor,
      onEdit: onEditRaw,
      languageId: "text",
      fontSize,
      schema: {},
    });
    editorHandleRef.current = handle;
    return () => {
      editorHandleRef.current = null;
      handle.destroy();
    };
  }, [fontSize, onEditRaw, tab.cursor, tab.text]);

  return { editorHostRef };
}

export { useCsvRawEditor, useCsvTable, useCsvTableView, useInlineEditCell };
