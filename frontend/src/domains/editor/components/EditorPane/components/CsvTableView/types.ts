import type { CSSProperties } from "react";
import type { EditorTab } from "@shell/types";

type CsvViewMode = "table" | "raw";

interface CsvData {
  headers: string[];
  rows: string[][];
  lineEnding: "\r\n" | "\n";
  trailingNewline: boolean;
}

interface CsvTableViewProps {
  tab: EditorTab;
}

interface CsvTableProps {
  data: CsvData;
  onCellEdit: (row: number, col: number, value: string) => void;
  onHeaderEdit: (col: number, value: string) => void;
  onDeleteRow: (row: number) => void;
  fontSize: number;
}

interface InlineEditCellProps {
  value: string;
  onCommit: (value: string) => void;
  testId?: string;
}

interface CsvRawEditorProps {
  tab: EditorTab;
  fontSize: number;
}

interface CsvTableStyle extends CSSProperties {
  "--mdbc-csv-table-font-size": string;
}

interface CsvCellEditStateStyle extends CSSProperties {
  "--mdbc-csv-cell-cursor": "text" | "default";
  "--mdbc-csv-cell-caret-color": "auto" | "transparent";
}

export type {
  CsvCellEditStateStyle,
  CsvData,
  CsvRawEditorProps,
  CsvTableProps,
  CsvTableStyle,
  CsvTableViewProps,
  CsvViewMode,
  InlineEditCellProps,
};
