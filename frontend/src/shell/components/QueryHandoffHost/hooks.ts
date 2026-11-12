import { useEffect } from "react";
import { subscribe } from "@shared/api";
import { useSettingsStore } from "@shared/settings";
import { useRunHistoryStore } from "@domains/results/hooks/runHistoryStore";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";
import { lineCommentPrefix } from "@domains/editor/utils/ui/lineCommentToggler";
import {
  HANDOFF_DEFAULT_COMMENT,
  HANDOFF_PAGE_SIZE,
  HANDOFF_SQL_SEPARATOR,
  HANDOFF_STATEMENT_END,
  HANDOFF_TAB_TITLE,
} from "./constants";
import { fetchRunPageIPC, takeQueryHandoffsIPC } from "./ipc";
import type { QueryHandoff, QueryTarget } from "./types";

/// "Claude 1a2b3c4d" names the console and tags each query from that session.
function sessionLabel(session: string | null): string {
  return session ? `${HANDOFF_TAB_TITLE} ${session}` : HANDOFF_TAB_TITLE;
}

/// The session's shared console for the connection, focused, or a new tab when asked for one.
function handoffTab(connectionId: string, newTab: boolean, title: string): EditorTab {
  const tabs = useTabsStore.getState();
  const shared = newTab
    ? undefined
    : tabs.tabs.find(
        (t) => t.tabType === "console" && t.title === title && t.connectionId === connectionId,
      );
  if (!shared) return tabs.addTab({ connectionId, title: newTab ? undefined : title });
  tabs.focusTab(shared.id);
  return shared;
}

// Reads ran on the server, so the tab shows that result rather than running again.
async function openQuery(handoff: QueryTarget): Promise<void> {
  const { connectionId, sql, runId, newTab, note, session } = handoff;
  const label = sessionLabel(session);
  const tab = handoffTab(connectionId, newTab, label);
  const marker = lineCommentPrefix(tab.kind) ?? HANDOFF_DEFAULT_COMMENT;
  const statement = sql.trimEnd().endsWith(HANDOFF_STATEMENT_END)
    ? sql.trimEnd()
    : `${sql.trimEnd()}${HANDOFF_STATEMENT_END}`;
  const block = note ? `${marker} ${label}: ${note}\n${statement}` : statement;
  const text = tab.text ? `${tab.text}${HANDOFF_SQL_SEPARATOR}${block}` : block;
  // refreshToken makes a mounted editor reload the text instead of keeping its own copy.
  useTabsStore.getState().updateTab(tab.id, {
    text,
    cursor: text.length - statement.length,
    refreshToken: (tab.refreshToken ?? 0) + 1,
  });
  if (!runId) return;
  const result = await fetchRunPageIPC(runId, 0, HANDOFF_PAGE_SIZE);
  const history = useRunHistoryStore.getState();
  const startedAt = Date.now();
  history.appendRun(tab.id, { id: runId, sqlSnapshot: sql, status: "pending", startedAt, connectionId });
  history.patchRun(tab.id, runId, { status: "success", result, endedAt: Date.now() });
  useTabsStore.getState().updateTab(tab.id, { result, pane: "results" });
  useSettingsStore.getState().showBottomPane();
  history.setRequestedPaneMode("results");
}

async function openHandoff(handoff: QueryHandoff): Promise<void> {
  if (handoff.kind === "canvas") {
    useTabsStore.getState().openCanvasTab({ id: handoff.canvasId, title: handoff.title });
    return;
  }
  await openQuery(handoff);
}

function useQueryHandoffs(): void {
  useEffect(() => {
    const pull = () => {
      takeQueryHandoffsIPC()
        .then((handoffs) => Promise.all(handoffs.map(openHandoff)))
        .catch(() => {});
    };
    pull();
    return subscribe((event) => {
      if (event.kind === "query_open_requested") pull();
    });
  }, []);
}

export { useQueryHandoffs };
