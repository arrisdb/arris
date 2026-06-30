import type { EditorTab } from "@shell/types";

import type { ShapeKind } from "../../types";

/// The active pointer tool. `move` selects and drags objects (panning empty
/// space); `hand` pans the board from anywhere and never drags an object;
/// `connect` draws a relationship arrow between two objects (click source, then
/// target).
type CanvasMode = "move" | "hand" | "connect";

/// Data carried on every ReactFlow node. Nodes read their live object + run
/// state from the store by `id` (props.id), so only the owning tab is needed.
interface CanvasNodeData {
  tabId: string;
}

interface CanvasViewProps {
  activeTab: EditorTab;
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
}

export type { CanvasMode, CanvasNodeData, CanvasToolbarProps, CanvasViewProps };
