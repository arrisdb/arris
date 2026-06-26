import { useTabsStore } from "@shell/hooks/tabsStore";
import { kindForConnection } from "@shell/utils";
import type { DatabaseKind, PinnedQuery } from "./types";

function openPinnedQuery(query: PinnedQuery): void {
  const editorKind = kindForConnection(query.kind as DatabaseKind);
  useTabsStore.getState().openPinnedQueryTab({
    pinnedQueryId: query.id,
    title: query.name,
    text: query.text,
    kind: editorKind,
    connectionId: query.connectionId,
  });
}

function queryPreview(text: string): string {
  return text.trim().split(/\r?\n/).slice(0, 5).join("\n");
}

export {
  openPinnedQuery,
  queryPreview,
};
