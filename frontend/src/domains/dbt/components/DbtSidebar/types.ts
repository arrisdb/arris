import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { ContextMenuItem } from "@shared/ui/ContextMenu";
import type {
  DbtNode,
  DbtNodeKind,
  DbtNodesByKind,
  DbtProject,
} from "../DbtProjectPane/types";

interface DbtSidebarViewModel {
  collapsed: Record<DbtNodeKind, boolean>;
  grouped: DbtNodesByKind;
  onClickSection: (kind: DbtNodeKind) => void;
  onSelectNode: (id: string) => void;
  project: DbtProject | null;
  selectedId: string | null;
}

interface DbtSidebarSectionProps {
  collapsed: boolean;
  items: DbtNode[];
  kind: DbtNodeKind;
  label: string;
  onClickSection: (kind: DbtNodeKind) => void;
  onSelectNode: (id: string) => void;
  selectedId: string | null;
}

interface DbtSidebarNodeRowProps {
  node: DbtNode;
  onClick: () => void;
  selected: boolean;
}

interface DbtSidebarNodeRowViewModel {
  menuItems: ContextMenuItem[];
  onContextMenuNode: (event: ReactMouseEvent) => void;
  rowClassName: string;
  swatchStyle: CSSProperties;
}

export type {
  DbtSidebarNodeRowProps,
  DbtSidebarNodeRowViewModel,
  DbtSidebarSectionProps,
  DbtSidebarViewModel,
};
