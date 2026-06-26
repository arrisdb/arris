import { useConnectionsStore } from "../../hooks";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { mountEditor } from "@domains/editor";
import { useSettingsStore } from "@shared/settings";
import type { EditorTab } from "@shell/types";

/// Mounts a read-only CodeMirror editor showing the object's DDL. Reuses the
/// shared `mountEditor` (same syntax highlighting as the SQL editor) with
/// `readOnly`, so there is no run bar, no editing, and no autocomplete writes.
/// Remounts whenever the tab, its DDL text, or the font size changes.
function useDefinitionEditor(
  activeTab: EditorTab,
  hostRef: RefObject<HTMLDivElement | null>,
): void {
  const connections = useConnectionsStore((s) => s.connections);
  const connectionKind = connections.find((c) => c.id === activeTab.connectionId)?.kind;
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  // Read latest font size without re-mounting on unrelated tab edits.
  const fontRef = useRef(editorFontSize);
  fontRef.current = editorFontSize;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = mountEditor({
      host,
      initialDoc: activeTab.text,
      languageId: activeTab.kind,
      connectionKind,
      fontSize: fontRef.current,
      readOnly: true,
      // Keep it non-editable but allow the Reformat command to pretty-print
      // the DDL programmatically.
      formattable: true,
    });
    return () => handle.destroy();
  }, [hostRef, activeTab.id, activeTab.text, activeTab.kind, connectionKind, editorFontSize]);
}

export { useDefinitionEditor };
