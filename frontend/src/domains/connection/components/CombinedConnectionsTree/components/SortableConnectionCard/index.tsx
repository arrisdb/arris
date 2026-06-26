import { type CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ConnectionCardProps } from "../../types";
import { ConnectionCard } from "../ConnectionCard";

/// Wraps a `ConnectionCard` as a dnd-kit sortable item. The drag listeners are
/// handed to the card header only (via `dragHandleProps`) so the body's schema
/// tree stays clickable; a 5px activation distance (set on the sensor) keeps a
/// plain click on the header expanding rather than starting a drag.
function SortableConnectionCard(props: ConnectionCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.conn.id });
  const dragStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Dim the in-list slot while dragging; the floating DragOverlay chip is the
    // thing the user follows.
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <ConnectionCard
      {...props}
      setDragNodeRef={setNodeRef}
      dragStyle={dragStyle}
      dragHandleProps={{ ...attributes, ...listeners }}
      dragging={isDragging}
    />
  );
}

export { SortableConnectionCard };
