import type { EditorTab } from "@shell/types";
import { iconForFileName, type IconName } from "@shared/ui/Icon";

// Leading icon for an editor tab. File tabs resolve through the shared
// `iconForFileName` helper so a `.sql` / `.yaml` / etc. tab matches the icon the
// same file gets in the sidebar file tree. Non-file tab types map to a fixed
// glyph; anything without one renders no leading icon.
function tabIconName(tab: EditorTab): IconName | null {
  switch (tab.tabType) {
    case "table":
      return "table";
    case "definition":
      return "fileText";
    case "file":
      return iconForFileName(tab.title);
    case "terminal":
      return "terminal";
    case "console":
      return "database";
    case "pinned":
      return "pin";
    case "notebook":
      return "notebook";
    case "gitdiff":
      return "gitBranch";
    case "gitcommitdiff":
      return "gitFork";
    case "githistory":
      return "history";
    default:
      return null;
  }
}

export { tabIconName };
