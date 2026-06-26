import type { CSSProperties } from "react";
import type {
  ContextMenuItem,
  PaneContextMenuItems,
} from "@shared/ui/ContextMenu";
import type { DbtNode } from "../DbtProjectPane/types";
import {
  kindColor,
  runDbtNode,
  testDbtNode,
} from "../DbtProjectPane/utils";

function dbtSidebarNodeMenuItems(node: DbtNode): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (node.kind === "model" || node.kind === "seed") {
    items.push({
      id: "run",
      label: "Run",
      action: () => {
        runDbtNode(node).catch(() => {});
      },
    });
  }
  if (node.kind === "model" || node.kind === "test") {
    items.push({
      id: "test",
      label: "Test",
      action: () => {
        testDbtNode(node).catch(() => {});
      },
    });
  }
  return items;
}

const dbtSidebarContextMenuItems: PaneContextMenuItems<null> = () => [];

function dbtSidebarRowClassName(selected: boolean): string {
  return `mdbc-row ${selected ? "selected" : ""} mdbc-dbt-sidebar-row`;
}

function dbtSidebarSwatchStyle(kind: string) {
  return {
    "--mdbc-dbt-sidebar-swatch-bg": kindColor(kind),
  } as CSSProperties;
}

export {
  dbtSidebarContextMenuItems,
  dbtSidebarNodeMenuItems,
  dbtSidebarRowClassName,
  dbtSidebarSwatchStyle,
};
