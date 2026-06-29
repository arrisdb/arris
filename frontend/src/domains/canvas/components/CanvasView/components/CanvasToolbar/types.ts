import type { IconName } from "@shared/ui/Icon";

/// One entry in a tool's pop-up menu (e.g. the shape kinds under the Shape tool).
interface ToolMenuItem {
  id: string;
  label: string;
  icon: IconName;
  shortcut?: string;
  disabled?: boolean;
  active?: boolean;
  onSelect: () => void;
}

/// A single button in the bottom toolbar. `onClick` is the primary action; a tool
/// with a `menu` also shows a caret that opens the menu of sub-options.
interface Tool {
  id: string;
  icon: IconName;
  title: string;
  active?: boolean;
  onClick?: () => void;
  menu?: ToolMenuItem[];
}

export type { Tool, ToolMenuItem };
