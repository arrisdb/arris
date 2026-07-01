import type { ContextMenuItem } from "@shared/ui/ContextMenu";

function canvasContextMenuItems({
  tabId,
  onRename,
  onDelete,
  onMoveToProject,
  onNewCanvas,
}: {
  tabId: string | null;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveToProject: (id: string) => void;
  onNewCanvas: () => void;
}): ContextMenuItem[] {
  if (!tabId) {
    return [{ id: "new-canvas", label: "New Canvas", action: onNewCanvas }];
  }
  return [
    { id: "rename", label: "Rename", action: () => onRename(tabId) },
    { id: "move-to-project", label: "Move to Project", action: () => onMoveToProject(tabId) },
    { id: "delete", label: "Delete", action: () => onDelete(tabId) },
  ];
}

export { canvasContextMenuItems };
