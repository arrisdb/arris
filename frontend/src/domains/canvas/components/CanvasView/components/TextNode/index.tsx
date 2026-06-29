import { memo, useState } from "react";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";

/// A free-text object (a textarea styled to read as prose). The textarea is only
/// `nodrag` while it has focus, so an idle text object can be dragged by its body
/// (click once to start editing, click away to move it again). `nowheel` keeps
/// ReactFlow from hijacking scroll.
function TextNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
  const [editing, setEditing] = useState(false);
  const component = useCanvasStore((s) =>
    s.boards[tabId]?.doc.components.find((c) => c.id === id),
  );
  const updateComponent = useCanvasStore((s) => s.updateComponent);
  if (!component || component.kind !== "text") return null;
  return (
    <>
      <CanvasResizer tabId={tabId} id={id} visible={selected} />
      <div className={`mdbc-canvas-node mdbc-canvas-text${selected ? " selected" : ""}`}>
        <textarea
          className={`nowheel mdbc-canvas-text-input${editing ? " nodrag" : ""}`}
          value={component.text}
          placeholder="Type text…"
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => updateComponent(tabId, id, { text: e.target.value })}
        />
      </div>
    </>
  );
}

const TextNode = memo(TextNodeImpl);

export { TextNode };
