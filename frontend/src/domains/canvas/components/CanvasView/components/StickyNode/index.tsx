import { memo, useEffect, useRef, useState } from "react";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";

/// A sticky note: free text on a coloured, shadowed card. A single click selects
/// + drags the note (the idle textarea is read-only with no pointer events);
/// double-click starts editing. Selection persists until the board is clicked.
function StickyNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const component = useCanvasStore((s) =>
    s.boards[tabId]?.doc.components.find((c) => c.id === id),
  );
  const updateComponent = useCanvasStore((s) => s.updateComponent);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!component || component.kind !== "sticky") return null;
  return (
    <>
      <CanvasResizer tabId={tabId} id={id} visible={selected} />
      <div
        className={`mdbc-canvas-node mdbc-canvas-sticky color-${component.color ?? "yellow"}${selected ? " selected" : ""}`}
        onDoubleClick={() => setEditing(true)}
      >
        <textarea
          ref={inputRef}
          className={`nowheel mdbc-canvas-sticky-input${editing ? " nodrag" : ""}`}
          value={component.text}
          placeholder="Note…"
          readOnly={!editing}
          onBlur={() => setEditing(false)}
          onChange={(e) => updateComponent(tabId, id, { text: e.target.value })}
        />
      </div>
    </>
  );
}

const StickyNode = memo(StickyNodeImpl);

export { StickyNode };
