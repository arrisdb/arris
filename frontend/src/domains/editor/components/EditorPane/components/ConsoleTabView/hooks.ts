import { useEffect } from "react";
import {
  SCHEMA_NODE_POINTER_DROP_EVENT,
  type SchemaNodePointerDropDetail,
} from "@domains/editor/utils/ui/schemaDrag";
import type { ConsoleTabViewProps } from "./types";

function useSchemaPointerDrop({
  activeTab,
  editorHandleRef,
  editorHostRef,
  focusGroup,
  groupId,
}: Pick<
  ConsoleTabViewProps,
  "activeTab" | "editorHandleRef" | "editorHostRef" | "focusGroup" | "groupId"
>) {
  useEffect(() => {
    function handleSchemaPointerDrop(event: Event) {
      if (!activeTab) return;
      const detail = (event as CustomEvent<SchemaNodePointerDropDetail>).detail;
      if (!detail) return;
      const host = editorHostRef.current;
      const handle = editorHandleRef.current;
      if (!host || !handle) return;
      const rect = host.getBoundingClientRect();
      if (
        detail.clientX < rect.left ||
        detail.clientX > rect.right ||
        detail.clientY < rect.top ||
        detail.clientY > rect.bottom
      ) {
        return;
      }
      focusGroup(groupId);
      handle.insertAtCoords(detail.clientX, detail.clientY, detail.insertText);
    }

    window.addEventListener(SCHEMA_NODE_POINTER_DROP_EVENT, handleSchemaPointerDrop);
    return () => window.removeEventListener(SCHEMA_NODE_POINTER_DROP_EVENT, handleSchemaPointerDrop);
  }, [activeTab, editorHandleRef, editorHostRef, focusGroup, groupId]);
}

export { useSchemaPointerDrop };
