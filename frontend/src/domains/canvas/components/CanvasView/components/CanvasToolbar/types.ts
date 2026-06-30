import type { IconName } from "@shared/ui/Icon";
import type { KeymapAction } from "@shared/settings";

/// One entry in a tool's pop-up menu (e.g. the shape kinds under the Shape tool).
/// When `action` is set, the displayed shortcut is read live from the keymap (so
/// it tracks user rebinds); `shortcut` is a static fallback for entries with no
/// bound command (e.g. a "Soon" placeholder).
interface ToolMenuItem {
  id: string;
  label: string;
  icon: IconName;
  action?: KeymapAction;
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
