import type { ContextMenuItem } from "@shared/ui/ContextMenu";

function terminalContextMenuItems({
  tabId,
  onRename,
  onClose,
  onNewTerminal,
}: {
  tabId: string | null;
  onRename: (id: string) => void;
  onClose: (id: string) => void;
  onNewTerminal: () => void;
}): ContextMenuItem[] {
  if (!tabId) {
    return [{ id: "new-terminal", label: "New Terminal", action: onNewTerminal }];
  }
  return [
    { id: "rename", label: "Rename", action: () => onRename(tabId) },
    { id: "close", label: "Close", action: () => onClose(tabId) },
  ];
}

export { terminalContextMenuItems };
