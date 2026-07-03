import type { KeymapAction } from "@shared/settings";

// New-tab dropdown entries, in display order. Each keymap action is the source
// of the item's label and shortcut hint; the component maps it to the prop
// callback that creates that tab type in this editor group.
const NEW_TAB_MENU: { action: KeymapAction; testId: string }[] = [
  { action: "openTab", testId: "tab-add-query" },
  { action: "newCanvasTab", testId: "tab-add-canvas" },
  { action: "newNotebookTab", testId: "tab-add-notebook" },
  { action: "newTerminalTab", testId: "tab-add-terminal" },
];

export { NEW_TAB_MENU };
