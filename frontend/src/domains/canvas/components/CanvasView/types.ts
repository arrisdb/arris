import type { EditorTab } from "@shell/types";

/// Data carried on every ReactFlow node. Nodes read their live object + run
/// state from the store by `id` (props.id), so only the owning tab is needed.
interface CanvasNodeData {
  tabId: string;
}

interface CanvasViewProps {
  activeTab: EditorTab;
}

interface CanvasToolbarProps {
  onAddText: () => void;
  onAddShape: () => void;
}

export type { CanvasNodeData, CanvasToolbarProps, CanvasViewProps };
