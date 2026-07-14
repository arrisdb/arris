import { memo, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";

/// A free-text object (a textarea styled to read as prose). A single click only
/// selects + drags the object (the idle textarea is read-only with no pointer
/// events, so the click falls through to the node); double-click starts editing.
/// Selection persists until the board is clicked, so the resize anchors stay up.
function TextNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
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

  if (!component || component.kind !== "text") return null;
  const style = component.style ?? {};
  const align = style.align ?? "left";
  // Text styling rides CSS custom properties (the inline-style guard allows only
  // `--`-prefixed props); weight/style + alignment ride classes. Underline and
  // strike both drive `text-decoration`, so they join into one var to avoid a
  // combinatorial set of `.underline.strike`-style selectors.
  const decoration =
    [style.underline && "underline", style.strike && "line-through"]
      .filter(Boolean)
      .join(" ") || "none";
  const css = {
    "--canvas-text-fs": `${style.fontSize ?? 16}px`,
    "--canvas-text-color": style.color ?? "var(--m-fg)",
    "--canvas-text-bg": style.backgroundColor ?? "transparent",
    "--canvas-text-decoration": decoration,
  } as CSSProperties;
  const classes = [
    "nowheel",
    "mdbc-canvas-text-input",
    `align-${align}`,
    style.bold && "bold",
    style.italic && "italic",
    editing && "nodrag",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <>
      <CanvasResizer tabId={tabId} id={id} visible={selected} />
      <div
        className={`mdbc-canvas-node mdbc-canvas-text${selected ? " selected" : ""}`}
        onDoubleClick={() => setEditing(true)}
      >
        <textarea
          ref={inputRef}
          className={classes}
          style={css}
          value={component.text}
          placeholder="Double-click to edit"
          readOnly={!editing}
          onBlur={() => setEditing(false)}
          onChange={(e) => updateComponent(tabId, id, { text: e.target.value })}
        />
      </div>
    </>
  );
}

const TextNode = memo(TextNodeImpl);

export { TextNode };
