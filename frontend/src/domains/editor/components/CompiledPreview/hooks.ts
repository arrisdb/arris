import { useEffect, useRef } from "react";
import { useSettingsStore } from "@shared/settings";
import { mountEditor } from "@domains/editor/utils/ui/setup";

function useCompiledPreviewEditor(compiledSql: string) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorFontSize = useSettingsStore((state) => state.editorFontSize);

  useEffect(() => {
    if (!compiledSql || !hostRef.current) return;
    const host = hostRef.current;
    host.innerHTML = "";
    const handle = mountEditor({
      host,
      initialDoc: compiledSql,
      languageId: "sql",
      readOnly: true,
      fontSize: editorFontSize,
    });
    return handle.destroy;
  }, [compiledSql, editorFontSize]);

  return { hostRef };
}

export { useCompiledPreviewEditor };
