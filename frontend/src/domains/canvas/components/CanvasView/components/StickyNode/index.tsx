import { memo, useState } from "react";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";

/// A sticky note: free text on a coloured, shadowed card. Reads as an annotation
/// pinned to the board. The textarea is `nodrag` only while focused, so an idle
/// note can be dragged by its body (click to edit, click away to move).
function StickyNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
  const [editing, setEditing] = useState(false);
  const component = useCanvasStore((s) =>
    s.boards[tabId]?.doc.components.find((c) => c.id === id),
  );
  const updateComponent = useCanvasStore((s) => s.updateComponent);
  if (!component || component.kind !== "sticky") return null;
  return (
    <>
      <CanvasResizer tabId={tabId} id={id} visible={selected} />
      <div
        className={`mdbc-canvas-node mdbc-canvas-sticky color-${component.color ?? "yellow"}${selected ? " selected" : ""}`}
      >
        <textarea
          className={`nowheel mdbc-canvas-sticky-input${editing ? " nodrag" : ""}`}
          value={component.text}
          placeholder="Note…"
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onChange={(e) => updateComponent(tabId, id, { text: e.target.value })}
        />
      </div>
    </>
  );
}

const StickyNode = memo(StickyNodeImpl);

export { StickyNode };
