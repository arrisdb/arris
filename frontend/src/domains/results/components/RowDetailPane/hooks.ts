import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useSettingsStore } from "@shared/settings";
import { mountEditor } from "@domains/editor";
import type { ColumnSpec, QueryValue } from "./types";
import { isSelectAllShortcut, rowToJson, selectJsonText } from "./utils";

function useRowDetailPane(columns: ColumnSpec[], row: QueryValue[] | null) {
  const jsonHostRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const json = useMemo(() => rowToJson(columns, row), [columns, row]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!jsonHostRef.current) return;
    return mountEditor({
      host: jsonHostRef.current,
      initialDoc: json,
      languageId: "json",
      readOnly: true,
      fontSize: editorFontSize,
    }).destroy;
  }, [json, editorFontSize]);

  // A new row's JSON resets the copied affordance back to the copy icon.
  useEffect(() => {
    setCopied(false);
  }, [json]);

  // Revert the copied checkmark to the copy icon shortly after a successful copy.
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const onClickCopy = useCallback(() => {
    if (!json) return;
    void navigator.clipboard
      ?.writeText(json)
      .then(() => setCopied(true))
      .catch(() => {});
  }, [json]);

  // The read-only editor's content is contenteditable=false and can't hold
  // keyboard focus, so focus the panel itself on mousedown; this is what lets
  // the Cmd+A handler below fire instead of the event bubbling to the browser.
  const onMouseDownContainer = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDownContainer = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!isSelectAllShortcut(event) || !jsonHostRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    selectJsonText(jsonHostRef.current);
  }, []);

  return {
    containerRef,
    copied,
    jsonHostRef,
    onClickCopy,
    onKeyDownContainer,
    onMouseDownContainer,
  };
}

export { useRowDetailPane };
