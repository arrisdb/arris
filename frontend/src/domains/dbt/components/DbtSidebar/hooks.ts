import { useCallback, useState } from "react";
import { useContextMenu } from "@shared/ui/ContextMenu";
import { useDbtStore } from "../../hooks";
import type {
  DbtNode,
  DbtNodeKind,
} from "../DbtProjectPane/types";
import { nodesByKind } from "../DbtProjectPane/utils";
import type {
  DbtSidebarNodeRowViewModel,
  DbtSidebarViewModel,
} from "./types";
import {
  dbtSidebarNodeMenuItems,
  dbtSidebarRowClassName,
  dbtSidebarSwatchStyle,
} from "./utils";

function useDbtSidebar(): DbtSidebarViewModel {
  const project = useDbtStore((state) => state.project);
  const selectedId = useDbtStore((state) => state.selectedNodeId);
  const selectNode = useDbtStore((state) => state.selectNode);
  const [collapsed, setCollapsed] = useState<Record<DbtNodeKind, boolean>>(
    () => ({}) as Record<DbtNodeKind, boolean>,
  );

  const onClickSection = useCallback((kind: DbtNodeKind) => {
    setCollapsed((current) => ({ ...current, [kind]: !current[kind] }));
  }, []);

  const onSelectNode = useCallback((id: string) => {
    selectNode(id);
  }, [selectNode]);

  return {
    collapsed,
    grouped: nodesByKind(project),
    onClickSection,
    onSelectNode,
    project,
    selectedId,
  };
}

function useDbtSidebarNodeRow(
  node: DbtNode,
  selected: boolean,
): DbtSidebarNodeRowViewModel & ReturnType<typeof useContextMenu<null>> {
  const menu = useContextMenu<null>();

  return {
    ...menu,
    menuItems: dbtSidebarNodeMenuItems(node),
    onContextMenuNode: (event) => menu.open(event, null),
    rowClassName: dbtSidebarRowClassName(selected),
    swatchStyle: dbtSidebarSwatchStyle(node.kind),
  };
}

export {
  useDbtSidebar,
  useDbtSidebarNodeRow,
};
