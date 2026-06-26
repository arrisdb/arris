import type { ContextMenuItem } from "@shared/ui/ContextMenu";

function consoleContextMenuItems({
  tabId,
  onRename,
  onDelete,
  onMoveToProject,
  onNewConsole,
}: {
  tabId: string | null;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveToProject: (id: string) => void;
  onNewConsole: () => void;
}): ContextMenuItem[] {
  if (!tabId) {
    return [{ id: "new-console", label: "New Console", action: onNewConsole }];
  }
  return [
    { id: "rename", label: "Rename", action: () => onRename(tabId) },
    { id: "move-to-project", label: "Move to Project", action: () => onMoveToProject(tabId) },
    { id: "delete", label: "Delete", action: () => onDelete(tabId) },
  ];
}

export { consoleContextMenuItems };
