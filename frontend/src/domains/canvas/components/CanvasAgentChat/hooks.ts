import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAgentStore } from "@domains/agent/hooks";
import { useConnectionsStore } from "@domains/connection/hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";

import type { SelectOption } from "@shared/ui";

import { CANVAS_SPEC_FENCE } from "../../constants";
import { useCanvasStore } from "../../hooks";
import { describeBoard, genId, parseAgentCanvas, serializeResultTable } from "../../utils";
import {
  cancelCanvasAgentIPC,
  fetchCanvasSchemaContextIPC,
  listenCanvasAgentEventsIPC,
  sendCanvasAgentIPC,
} from "./ipc";
import type { CanvasAgentEventEnvelope } from "./ipc";
import type { ChatEntry, ResultAttachment } from "./types";

/// Serialize the attached query results into the prompt preamble the agent sees,
/// one titled markdown table per attachment.
function serializeAttachments(attachments: ResultAttachment[]): string {
  if (attachments.length === 0) return "";
  return `${attachments.map((a) => `# Results: ${a.label}\n${a.table}`).join("\n\n")}\n\n`;
}

/// Strip the arris-canvas fenced block from the agent's reply so the chat shows
/// only the prose. Used for the streaming bubble and the final fallback text.
function displayText(raw: string): string {
  const re = new RegExp("```" + CANVAS_SPEC_FENCE + "[\\s\\S]*?```", "g");
  return raw.replace(re, "").trim();
}

function errToString(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

/// Drive the canvas chat: send a prompt as a canvas-profile agent turn, stream
/// the reply, and on completion parse the arris-canvas block into board objects,
/// auto-running any query objects. Filters `agent-event`s to its own turn so it
/// never picks up the SQL chat's turns.
function useCanvasAgentChat(tab: EditorTab) {
  const tabId = tab.id;
  const connectionId = tab.connectionId ?? null;

  // The board's connection is canvas-wide: the agent reads its schema and every
  // query object runs against it. Picking one binds it to the tab.
  const connections = useConnectionsStore((s) => s.connections);
  const connectionOptions = useMemo(
    () => connections.map((c) => ({ value: c.id, label: c.name })),
    [connections],
  );
  const pickConnection = useCallback(
    (id: string) => {
      const conn = connections.find((c) => c.id === id);
      if (!conn) return;
      if (!conn.isConnected) useConnectionsStore.getState().connectAndLoad(id);
      useConnectionsStore.getState().selectConnection(id);
      useTabsStore.getState().updateTab(tabId, { connectionId: id });
    },
    [connections, tabId],
  );

  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [streaming, setStreaming] = useState(false);

  // Query objects the user attached to the next message (not automatic). The
  // picker lists every query object that currently has a result; attaching one
  // serializes its rows and shows a removable chip above the input.
  const [attachments, setAttachments] = useState<ResultAttachment[]>([]);
  const board = useCanvasStore((s) => s.boards[tabId]);
  const resultOptions = useMemo<SelectOption[]>(() => {
    if (!board) return [];
    const opts: SelectOption[] = [];
    for (const c of board.doc.components) {
      if (c.kind !== "query") continue;
      const result = board.runs[c.id]?.result;
      if (!result) continue;
      opts.push({
        value: c.id,
        label: `${c.title ?? "Query"} · ${result.rows.length}×${result.columns.length}`,
      });
    }
    return opts;
  }, [board]);

  const attachResult = useCallback(
    (queryId: string) => {
      const cur = useCanvasStore.getState().boards[tabId];
      const comp = cur?.doc.components.find((c) => c.id === queryId);
      const result = cur?.runs[queryId]?.result;
      if (!comp || comp.kind !== "query" || !result) return;
      const { table, rowCount, colCount } = serializeResultTable(result);
      const label = `${comp.title ?? "Query"} · ${rowCount}×${colCount}`;
      // Replace any prior attachment of the same query so re-running and
      // re-attaching refreshes rather than duplicating.
      setAttachments((prev) => [
        ...prev.filter((a) => a.queryId !== queryId),
        { id: genId("att"), queryId, label, table },
      ]);
    },
    [tabId],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // The schema DDL the agent will receive for this connection. Fetched (with a
  // spinner) whenever the connection changes, so the panel can be explicit about
  // reading the database's tables and can preview the exact context.
  const [schemaContext, setSchemaContext] = useState("");
  const [schemaLoading, setSchemaLoading] = useState(false);

  useEffect(() => {
    if (!connectionId) {
      setSchemaContext("");
      setSchemaLoading(false);
      return;
    }
    let active = true;
    setSchemaLoading(true);
    fetchCanvasSchemaContextIPC(connectionId)
      .then((ddl) => {
        if (active) setSchemaContext(ddl);
      })
      .catch(() => {
        if (active) setSchemaContext("");
      })
      .finally(() => {
        if (active) setSchemaLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connectionId]);

  // The exact context block the agent receives: the schema DDL plus the current
  // board summary. Read at call time so the board section is always current.
  const buildContext = useCallback(() => {
    const components =
      useCanvasStore.getState().boards[tabId]?.doc.components ?? [];
    const board = describeBoard(components);
    return [
      "# Database schema (sent to the agent)",
      schemaContext.trim() || "(no schema loaded for this connection)",
      "",
      "# Current board",
      board || "The board is empty.",
    ].join("\n");
  }, [schemaContext, tabId]);

  const turnIdRef = useRef<string | null>(null);
  const agentEntryIdRef = useRef<string | null>(null);
  const accumRef = useRef("");
  const sessionRef = useRef<string | null>(null);
  // The provider this turn runs under, and the one that produced the live
  // session: a codex session id can't be resumed under claude (and vice versa),
  // so switching providers in the header starts a fresh session.
  const turnProviderRef = useRef<string | null>(null);
  const sessionProviderRef = useRef<string | null>(null);

  const setAgentText = useCallback((text: string, pending: boolean) => {
    const id = agentEntryIdRef.current;
    if (!id) return;
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, text, pending } : e)));
  }, []);

  const endTurn = useCallback(() => {
    turnIdRef.current = null;
    setStreaming(false);
  }, []);

  const handleEvent = useCallback(
    (evt: CanvasAgentEventEnvelope) => {
      if (!turnIdRef.current || evt.turn_id !== turnIdRef.current) return;
      switch (evt.kind) {
        case "session_started":
          if (evt.session_id) sessionRef.current = evt.session_id;
          sessionProviderRef.current = turnProviderRef.current;
          return;
        case "message":
          if (evt.text) {
            accumRef.current += evt.text;
            setAgentText(displayText(accumRef.current), true);
          }
          return;
        case "error":
          setAgentText(`Error: ${evt.message ?? "the agent failed."}`, false);
          endTurn();
          return;
        case "done": {
          const spec = parseAgentCanvas(accumRef.current);
          if (spec) {
            const queryIds = useCanvasStore
              .getState()
              .applyAgentSpec(tabId, spec, connectionId);
            for (const id of queryIds) {
              void useCanvasStore.getState().runQueryComponent(tabId, id);
            }
            const n = spec.components.length;
            const prose = displayText(accumRef.current);
            const summary = `Added ${n} object${n === 1 ? "" : "s"} to the canvas.`;
            setAgentText(prose ? `${prose}\n\n${summary}` : summary, false);
          } else {
            setAgentText(displayText(accumRef.current) || "No objects were generated.", false);
          }
          endTurn();
          return;
        }
        default:
          return;
      }
    },
    [connectionId, endTurn, setAgentText, tabId],
  );

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    listenCanvasAgentEventsIPC(handleEvent).then((un) => {
      if (active) unlisten = un;
      else un();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [handleEvent]);

  const send = useCallback(
    (prompt: string) => {
      const text = prompt.trim();
      if (!text || streaming) return;
      if (!connectionId) {
        setEntries((prev) => [
          ...prev,
          { id: genId("msg"), role: "user", text },
          {
            id: genId("msg"),
            role: "agent",
            text: "Connect a database to this canvas first so I can read its schema.",
          },
        ]);
        return;
      }
      const turnId = genId("turn");
      turnIdRef.current = turnId;
      accumRef.current = "";
      const agentId = genId("msg");
      agentEntryIdRef.current = agentId;
      setEntries((prev) => [
        ...prev,
        { id: genId("msg"), role: "user", text },
        { id: agentId, role: "agent", text: "", pending: true },
      ]);
      setStreaming(true);
      const provider = useAgentStore.getState().provider;
      turnProviderRef.current = provider;
      // Only resume when the live session was produced by the same provider; a
      // header switch (codex <-> claude) must start fresh.
      const resumeSession =
        sessionRef.current && sessionProviderRef.current === provider
          ? sessionRef.current
          : null;
      const boardContext = describeBoard(
        useCanvasStore.getState().boards[tabId]?.doc.components ?? [],
      );
      sendCanvasAgentIPC({
        provider,
        connectionId,
        // Attached query results ride in front of the user's prompt; the chat
        // bubble still shows only `text`.
        prompt: `${serializeAttachments(attachments)}${text}`,
        boardContext,
        turnId,
        resumeSession,
      }).catch((e) => {
        setAgentText(`Error: ${errToString(e)}`, false);
        endTurn();
      });
      setAttachments([]);
    },
    [attachments, connectionId, endTurn, setAgentText, streaming, tabId],
  );

  const cancel = useCallback(() => {
    const turnId = turnIdRef.current;
    if (!turnId) return;
    void cancelCanvasAgentIPC(turnId);
    setAgentText("Stopped.", false);
    endTurn();
  }, [endTurn, setAgentText]);

  return {
    attachResult,
    attachments,
    buildContext,
    cancel,
    connectionId,
    connectionOptions,
    entries,
    pickConnection,
    removeAttachment,
    resultOptions,
    schemaLoading,
    send,
    streaming,
  };
}

export { useCanvasAgentChat };
