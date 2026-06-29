import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAgentStore } from "@domains/agent/hooks";
import { useConnectionsStore } from "@domains/connection/hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";

import { CANVAS_SPEC_FENCE } from "../../constants";
import { useCanvasStore } from "../../hooks";
import { describeBoard, genId, parseAgentCanvas } from "../../utils";
import {
  cancelCanvasAgentIPC,
  listenCanvasAgentEventsIPC,
  sendCanvasAgentIPC,
} from "./ipc";
import type { CanvasAgentEventEnvelope } from "./ipc";
import type { ChatEntry } from "./types";

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
        prompt: text,
        boardContext,
        turnId,
        resumeSession,
      }).catch((e) => {
        setAgentText(`Error: ${errToString(e)}`, false);
        endTurn();
      });
    },
    [connectionId, endTurn, setAgentText, streaming, tabId],
  );

  const cancel = useCallback(() => {
    const turnId = turnIdRef.current;
    if (!turnId) return;
    void cancelCanvasAgentIPC(turnId);
    setAgentText("Stopped.", false);
    endTurn();
  }, [endTurn, setAgentText]);

  return {
    cancel,
    connectionId,
    connectionOptions,
    entries,
    pickConnection,
    send,
    streaming,
  };
}

export { useCanvasAgentChat };
