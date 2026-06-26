import type { ContextMenuItem } from "@shared/ui/ContextMenu";

function notebookContextMenuItems({
  tabId,
  onRename,
  onDelete,
  onMoveToProject,
  onNewNotebook,
}: {
  tabId: string | null;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onMoveToProject: (id: string) => void;
  onNewNotebook: () => void;
}): ContextMenuItem[] {
  if (!tabId) {
    return [{ id: "new-notebook", label: "New Jupyter Notebook", action: onNewNotebook }];
  }
  return [
    { id: "rename", label: "Rename", action: () => onRename(tabId) },
    { id: "move-to-project", label: "Move to Project", action: () => onMoveToProject(tabId) },
    { id: "delete", label: "Delete", action: () => onDelete(tabId) },
  ];
}

export { notebookContextMenuItems };
