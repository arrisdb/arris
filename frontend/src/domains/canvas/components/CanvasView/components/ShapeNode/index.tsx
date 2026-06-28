import { memo } from "react";
import type { NodeProps } from "reactflow";

import { useCanvasStore } from "../../../../hooks";
import type { CanvasNodeData } from "../../types";

/// A decorative shape (rectangle, ellipse, or horizontal line). Fills its node
/// box; the radius/line treatment is chosen by the shape kind.
function ShapeNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
  const component = useCanvasStore((s) =>
    s.boards[tabId]?.doc.components.find((c) => c.id === id),
  );
  if (!component || component.kind !== "shape") return null;
  const style = component.style ?? {};
  const css = {
    background: component.shape === "line" ? "transparent" : (style.fill ?? "rgb(var(--m-accent-rgb) / 0.12)"),
    border:
      component.shape === "line"
        ? "none"
        : `${style.strokeWidth ?? 1}px solid ${style.stroke ?? "rgb(var(--m-accent-rgb) / 0.5)"}`,
    borderTop:
      component.shape === "line"
        ? `${style.strokeWidth ?? 2}px solid ${style.stroke ?? "rgb(var(--m-accent-rgb) / 0.6)"}`
        : undefined,
    borderRadius: component.shape === "ellipse" ? "50%" : "var(--m-r-md)",
  };
  return (
    <div
      className={`mdbc-canvas-node mdbc-canvas-shape${selected ? " selected" : ""}`}
      style={css}
    />
  );
}

const ShapeNode = memo(ShapeNodeImpl);

export { ShapeNode };
