import type { EditorTab } from "../../types";
import { DEFAULT_TAB_TYPE } from "./constants";
import type { UiContext } from "./types";

/// What an external agent needs to act on "this query" or "this selection".
function buildUiContext(tab: EditorTab | undefined): UiContext {
  if (!tab) return { tab: null };
  const { from, to } = tab.selection ?? { from: 0, to: 0 };
  return {
    tab: {
      id: tab.id,
      title: tab.title,
      tabType: tab.tabType ?? DEFAULT_TAB_TYPE,
      ...(tab.connectionId ? { connectionId: tab.connectionId } : {}),
      ...(tab.text ? { text: tab.text } : {}),
      ...(from !== to ? { selection: { from, to, text: tab.text.slice(from, to) } } : {}),
    },
  };
}

export { buildUiContext };
