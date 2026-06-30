import { memo } from "react";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import type { CanvasNodeData } from "../../types";

/// A free-text object. Always editable (a transparent textarea styled to read as
/// prose); `nodrag`/`nowheel` keep ReactFlow from hijacking pointer + scroll.
function TextNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
  const component = useCanvasStore((s) =>
    s.boards[tabId]?.doc.components.find((c) => c.id === id),
  );
  const updateComponent = useCanvasStore((s) => s.updateComponent);
  if (!component || component.kind !== "text") return null;
  return (
    <div className={`mdbc-canvas-node mdbc-canvas-text${selected ? " selected" : ""}`}>
      <textarea
        className="nodrag nowheel mdbc-canvas-text-input"
        value={component.text}
        placeholder="Type text…"
        onChange={(e) => updateComponent(tabId, id, { text: e.target.value })}
      />
    </div>
  );
}

const TextNode = memo(TextNodeImpl);

export { TextNode };
