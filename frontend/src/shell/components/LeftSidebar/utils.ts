import type { PaneContextMenuItems } from "@shared/ui/ContextMenu";

function hasProjectMetadata(
  project: unknown,
  rootPath: string | null | undefined,
  isLoading: boolean,
): boolean {
  return !!(project || rootPath || isLoading);
}

function leftPaneContextMenuItems(): ReturnType<PaneContextMenuItems<null>> {
  return [];
}

export {
  hasProjectMetadata,
  leftPaneContextMenuItems,
};
