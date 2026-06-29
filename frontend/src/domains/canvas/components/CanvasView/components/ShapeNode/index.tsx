import { memo, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";

/// A shape (rectangle, ellipse, or horizontal line) that fills its node box and
/// can hold a centered label. A single click selects + drags it; double-click
/// edits the label. The "Add text" hint shows only while the shape is selected.
/// Rectangles also get a radius handle (riding the top edge) to round corners.
function ShapeNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
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

  if (!component || component.kind !== "shape") return null;
  const style = component.style ?? {};
  const isLine = component.shape === "line";
  const radius = component.radius ?? 0;
  const text = component.text ?? "";
  const css = {
    background: isLine ? "transparent" : (style.fill ?? "#3a3950"),
    border: isLine
      ? "none"
      : `${style.strokeWidth ?? 1}px solid ${style.stroke ?? "rgb(var(--m-accent-rgb) / 0.6)"}`,
    borderTop: isLine
      ? `${style.strokeWidth ?? 2}px solid ${style.stroke ?? "rgb(var(--m-accent-rgb) / 0.6)"}`
      : undefined,
    borderRadius:
      component.shape === "ellipse" ? "50%" : isLine ? undefined : `${radius}px`,
  };

  // Drag the radius handle right to round the corners, left to square them.
  // Bounded to half the shorter side (a fully-rounded "stadium"). Adjusts in
  // screen px; close enough at canvas zoom 1.
  const onPointerDownRadius = (event: ReactPointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    const startX = event.clientX;
    const startR = radius;
    const maxR = Math.min(component.w, component.h) / 2;
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(0, Math.min(maxR, startR + (ev.clientX - startX)));
      updateComponent(tabId, id, { radius: next });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // The handle rides the top edge, offset from the left corner by the radius
  // (clamped so it never leaves the edge).
  const handleX = Math.min(Math.max(radius, 14), component.w - 14);

  return (
    <>
      <CanvasResizer tabId={tabId} id={id} visible={selected} />
      <div
        className={`mdbc-canvas-node mdbc-canvas-shape${selected ? " selected" : ""}`}
        style={css}
        onDoubleClick={() => {
          if (!isLine) setEditing(true);
        }}
      >
        {!isLine &&
          (editing ? (
            <textarea
              ref={inputRef}
              className="nowheel nodrag mdbc-canvas-shape-text"
              value={text}
              onBlur={() => setEditing(false)}
              onChange={(e) => updateComponent(tabId, id, { text: e.target.value })}
            />
          ) : (
            <div
              className={`mdbc-canvas-shape-label${text ? "" : " placeholder"}`}
            >
              {text || (selected ? "Add text" : "")}
            </div>
          ))}
        {selected && component.shape === "rect" && (
          <div
            className="nodrag nopan mdbc-canvas-radius-handle"
            style={{ "--radius-handle-x": `${handleX}px` } as CSSProperties}
            onPointerDown={onPointerDownRadius}
            data-testid="canvas-radius-handle"
          />
        )}
      </div>
    </>
  );
}

const ShapeNode = memo(ShapeNodeImpl);

export { ShapeNode };
