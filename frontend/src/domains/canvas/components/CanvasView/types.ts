import type { EditorTab } from "@shell/types";

import type { ShapeKind } from "../../types";

/// The active pointer tool. `move` selects and drags objects (panning empty
/// space); `hand` pans the board from anywhere and never drags an object.
/// Relationship arrows are drawn automatically from cell dependencies, so there
/// is no manual connect tool.
type CanvasMode = "move" | "hand";

/// Data carried on every ReactFlow node. Nodes read their live object + run
/// state from the store by `id` (props.id), so only the owning board is needed.
interface CanvasNodeData {
  boardId: string;
}

interface CanvasViewProps {
  canvasId: string;
  /// The desktop tab hosting the board; present only in the desktop app, where it
  /// enables the agent chat panel.
  tab?: EditorTab;
}

interface CanvasToolbarProps {
  mode: CanvasMode;
  onModeChange: (mode: CanvasMode) => void;
  onAddQuery: () => void;
  onAddChart: () => void;
  onAddTable: () => void;
  onAddSticky: () => void;
  onAddText: () => void;
  onAddShape: (shape: ShapeKind) => void;
  onRunAll: () => void;
}

export type { CanvasMode, CanvasNodeData, CanvasToolbarProps, CanvasViewProps };
