import type { DatabaseKind, SchemaNode } from "@shared";
import type { EditorTab } from "@shell/types";
import type { NotebookCell } from "../../types";
import type { SelectOption } from "@shared/ui/Select";

import type { CompleteFn } from "./utils/editor";

interface NotebookViewProps {
  activeTab: EditorTab;
}

/// Props for one rendered notebook cell. Source is carried on `cell` but is
/// intentionally NOT a re-render trigger (see `cellViewPropsEqual`).
interface CellViewProps {
  cell: NotebookCell;
  notebookId: string;
  connectionOptions: SelectOption[];
  /// SQL cells: the chosen connection's kind, for the dialect-aware completion.
  connectionKind: DatabaseKind | undefined;
  /// SQL cells: the loaded schema tree for the chosen connection (if any).
  schemaNodes: SchemaNode[] | undefined;
  editorFontSize: number;
  complete: CompleteFn;
  runCell: (cellId: string) => void;
  /// Run the given cell, then insert a same-type cell below and focus it (bound
  /// to the cell editor's Shift+Enter and the "run & insert below" command).
  onRunInsert: (cellId: string) => void;
  onSelect: (cellId: string) => void;
  /// Id of the cell whose editor should grab focus on its next render (set by
  /// "run & insert below"). Only the matching cell auto-focuses.
  focusCellId: string | null;
}

/// A discovered Python interpreter, mirroring the backend `PythonInterpreter`.
interface PythonInterpreter {
  path: string;
  version: string;
  source: "path" | "pyenv" | "common" | "venv";
}

/// Kernel completion result mirroring the backend `Completion` struct.
interface Completion {
  matches: string[];
  cursorStart: number;
  cursorEnd: number;
}

/// Result of creating a venv, mirroring the backend `CreatedVenv`. `ipykernelReady`
/// is true when ipykernel was installed during creation, so the kernel can launch
/// without a second probe.
interface CreatedVenv {
  interpreter: PythonInterpreter;
  ipykernelReady: boolean;
}

export type { CellViewProps, Completion, CreatedVenv, NotebookViewProps, PythonInterpreter };
