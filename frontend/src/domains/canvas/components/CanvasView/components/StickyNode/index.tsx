import { memo } from "react";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";

/// A sticky note: free text on a coloured, shadowed card. Reads as an annotation
/// pinned to the board. `nodrag`/`nowheel` keep ReactFlow from hijacking the
/// textarea's pointer + scroll while editing.
function StickyNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
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
          className="nodrag nowheel mdbc-canvas-sticky-input"
          value={component.text}
          placeholder="Note…"
          onChange={(e) => updateComponent(tabId, id, { text: e.target.value })}
        />
      </div>
    </>
  );
}

const StickyNode = memo(StickyNodeImpl);

export { StickyNode };
