import { useCsvRawEditor } from "../../hooks";
import type { CsvRawEditorProps } from "../../types";

function CsvRawEditor({ tab, fontSize }: CsvRawEditorProps) {
  const rawEditor = useCsvRawEditor(tab, fontSize);

  return (
    <div
      className="mdbc-csv-table-fill-hidden"
      ref={rawEditor.editorHostRef}
      data-testid="csv-raw-editor"
    />
  );
}

export { CsvRawEditor };
