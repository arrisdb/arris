import type { ContextMenuItem } from "@shared/ui/ContextMenu";

function canvasContextMenuItems({
  canvasId,
  onRename,
  onDelete,
  onNewCanvas,
}: {
  canvasId: string | null;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onNewCanvas: () => void;
}): ContextMenuItem[] {
  if (!canvasId) {
    return [{ id: "new-canvas", label: "New Canvas", action: onNewCanvas }];
  }
  return [
    { id: "rename", label: "Rename", action: () => onRename(canvasId) },
    { id: "delete", label: "Delete", action: () => onDelete(canvasId) },
  ];
}

export { canvasContextMenuItems };
