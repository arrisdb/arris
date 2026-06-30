import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAgentStore } from "@domains/agent/hooks";
import { useConnectionsStore } from "@domains/connection/hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";

import { CANVAS_ASK_FENCE, CANVAS_SPEC_FENCE } from "../../constants";
import { useCanvasStore } from "../../hooks";
import {
  buildQuestionAnswer,
  describeBoard,
  genId,
  parseAgentCanvas,
  parseAgentQuestion,
} from "../../utils";
import type { ShareableQuery } from "../../utils";
import type { AgentQuestionAnswer } from "../../types";
import {
  cancelCanvasAgentIPC,
  fetchCanvasSchemaContextIPC,
  listenCanvasAgentEventsIPC,
  sendCanvasAgentIPC,
} from "./ipc";
import type { CanvasAgentEventEnvelope } from "./ipc";
import type { ChatEntry } from "./types";

/// Read the board's query objects into the shareable shape the question-answer
/// builder needs (title + result, when the cell has run).
function shareableQueries(tabId: string): ShareableQuery[] {
  const board = useCanvasStore.getState().boards[tabId];
  if (!board) return [];
  const out: ShareableQuery[] = [];
  for (const c of board.doc.components) {
    if (c.kind !== "query") continue;
    out.push({ id: c.id, title: c.title ?? "Query", result: board.runs[c.id]?.result });
  }
  return out;
}

/// Assemble the schema the agent receives for a multi-connection board: one
/// section per connection, headed with the connection's name, id, and dialect so
/// the agent can set each query object's `connectionId` to the right database.
function assembleSchemaContext(
  ids: string[],
  nameOf: (id: string) => string,
  dialectOf: (id: string) => string,
  schemaByConn: Record<string, string>,
): string {
  return ids
    .map((id) => {
      const ddl =
        (schemaByConn[id] ?? "").trim() || "(no schema loaded for this connection)";
      return `## Connection ${JSON.stringify(nameOf(id))} (id=${id}, ${dialectOf(id)})\n${ddl}`;
    })
    .join("\n\n");
}

/// Strip the agent's machine-readable fenced blocks (board spec and questions)
/// from its reply so the chat shows only the prose. Used for the streaming bubble
/// and the final fallback text.
function displayText(raw: string): string {
  const re = new RegExp(
    "```(?:" + CANVAS_SPEC_FENCE + "|" + CANVAS_ASK_FENCE + ")[\\s\\S]*?```",
    "g",
  );
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

  // A board can target several connections at once: the agent reads every chosen
  // connection's schema and may run each query object against a different one.
  const connections = useConnectionsStore((s) => s.connections);
  const connectionOptions = useMemo(
    () => connections.map((c) => ({ value: c.id, label: c.name })),
    [connections],
  );
  const connById = useMemo(
    () => new Map(connections.map((c) => [c.id, c])),
    [connections],
  );
  // Pick the board's connections (multi-select). The first is the primary: the
  // default for new query objects and the global selection. Each is connected
  // and loaded so its schema is ready for the agent.
  const pickConnections = useCallback(
    (ids: string[]) => {
      useCanvasStore.getState().setConnectionIds(tabId, ids);
      for (const id of ids) {
        const conn = connections.find((c) => c.id === id);
        if (conn && !conn.isConnected) useConnectionsStore.getState().connectAndLoad(id);
      }
      const primary = ids[0];
      if (primary) {
        useConnectionsStore.getState().selectConnection(primary);
        useTabsStore.getState().updateTab(tabId, { connectionId: primary });
      } else {
        useTabsStore.getState().updateTab(tabId, { connectionId: undefined });
      }
    },
    [connections, tabId],
  );

  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [streaming, setStreaming] = useState(false);
  const board = useCanvasStore((s) => s.boards[tabId]);

  // The connections the agent may use, from the persisted board doc. An older
  // board with no set falls back to the tab's primary connection. The first id
  // is the primary (drives the "no connection" gating and the single-connection
  // backend path).
  const connectionIds = useMemo<string[]>(() => {
    const fromDoc = board?.doc.connectionIds;
    if (fromDoc && fromDoc.length > 0) return fromDoc;
    return tab.connectionId ? [tab.connectionId] : [];
  }, [board?.doc.connectionIds, tab.connectionId]);
  const connectionId = connectionIds[0] ?? null;

  // For the question card: a query object's title and its run dimensions, so a
  // `share_results` request can show what it is asking to share.
  const describeQuery = useCallback(
    (id: string) => {
      const comp = board?.doc.components.find((c) => c.id === id);
      const title =
        comp?.kind === "query" ? comp.title ?? "Query" : comp ? "Query" : "(missing cell)";
      const result = board?.runs[id]?.result;
      return {
        title,
        hasResult: Boolean(result),
        rowCount: result?.rows.length ?? 0,
        colCount: result?.columns.length ?? 0,
      };
    },
    [board],
  );

  // The schema DDL the agent will receive for this connection. Fetched (with a
  // spinner) whenever the connection changes, so the panel can be explicit about
  // reading the database's tables and can preview the exact context.
  const [schemaByConn, setSchemaByConn] = useState<Record<string, string>>({});
  const [schemaLoading, setSchemaLoading] = useState(false);

  useEffect(() => {
    if (connectionIds.length === 0) {
      setSchemaByConn({});
      setSchemaLoading(false);
      return;
    }
    let active = true;
    setSchemaLoading(true);
    Promise.all(
      connectionIds.map((id) =>
        fetchCanvasSchemaContextIPC(id)
          .then((ddl) => [id, ddl] as const)
          .catch(() => [id, ""] as const),
      ),
    )
      .then((pairs) => {
        if (active) setSchemaByConn(Object.fromEntries(pairs));
      })
      .finally(() => {
        if (active) setSchemaLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connectionIds]);

  const nameOf = useCallback((id: string) => connById.get(id)?.name ?? id, [connById]);
  const dialectOf = useCallback((id: string) => connById.get(id)?.kind ?? "sql", [connById]);
  // More than one connection means the backend can't resolve a single schema, so
  // we assemble one labeled per connection and pass it as the override.
  const multiConnection = connectionIds.length > 1;
  const agentSchema = useCallback(
    () => assembleSchemaContext(connectionIds, nameOf, dialectOf, schemaByConn),
    [connectionIds, nameOf, dialectOf, schemaByConn],
  );

  // The exact context block the agent receives: the schema DDL plus the current
  // board summary. Read at call time so the board section is always current.
  const buildContext = useCallback(() => {
    const components =
      useCanvasStore.getState().boards[tabId]?.doc.components ?? [];
    const board = describeBoard(components);
    return [
      "# Database schema (sent to the agent)",
      agentSchema(),
      "",
      "# Current board",
      board || "The board is empty.",
    ].join("\n");
  }, [agentSchema, tabId]);

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
          // A question takes precedence: the agent is asking the user for input
          // (e.g. to share results) rather than changing the board, so render a
          // question card on the agent entry and apply nothing.
          const question = parseAgentQuestion(accumRef.current);
          if (question) {
            const id = agentEntryIdRef.current;
            const prose = displayText(accumRef.current);
            if (id) {
              setEntries((prev) =>
                prev.map((e) =>
                  e.id === id ? { ...e, text: prose, pending: false, question } : e,
                ),
              );
            }
            endTurn();
            return;
          }
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

  // Dispatch one agent turn: push the user bubble + a pending agent entry, then
  // stream the reply. `prompt` is what the agent receives; `userText` is the chat
  // bubble. They differ when answering a question, where the prompt carries the
  // shared result tables but the bubble is a short note.
  const runTurn = useCallback(
    (prompt: string, userText: string) => {
      const turnId = genId("turn");
      turnIdRef.current = turnId;
      accumRef.current = "";
      const agentId = genId("msg");
      agentEntryIdRef.current = agentId;
      setEntries((prev) => [
        ...prev,
        { id: genId("msg"), role: "user", text: userText },
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
        // A multi-connection board carries several dialects, so the prompt stays
        // dialect-generic (connectionId null); a single-connection board passes
        // its connection so the prompt names that dialect.
        connectionId: multiConnection ? null : connectionId,
        prompt,
        boardContext,
        // Always hand the backend the id-headed schema, even for one connection.
        // Each `## Connection ... id=<id>` header tells the agent the id to write
        // when it MOVES a query onto that connection; without it a single-
        // connection turn can rewrite a cell's SQL but never change its
        // connectionId (it has no id to reference).
        schemaOverride: agentSchema(),
        turnId,
        resumeSession,
      }).catch((e) => {
        setAgentText(`Error: ${errToString(e)}`, false);
        endTurn();
      });
    },
    [agentSchema, connectionId, endTurn, multiConnection, setAgentText, tabId],
  );

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
      runTurn(text, text);
    },
    [connectionId, runTurn, streaming],
  );

  // Answer a question the agent asked: mark the card resolved, build the
  // follow-up turn for that question type, and send it (the prompt carries the
  // shared rows; the chat bubble shows a short note).
  const answerQuestion = useCallback(
    (entryId: string, answer: AgentQuestionAnswer) => {
      if (streaming) return;
      const entry = entries.find((e) => e.id === entryId);
      if (!entry?.question || entry.answered) return;
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, answered: true } : e)),
      );
      const followUp = buildQuestionAnswer(entry.question, answer, shareableQueries(tabId));
      if (followUp) runTurn(followUp.prompt, followUp.note);
    },
    [entries, runTurn, streaming, tabId],
  );

  const cancel = useCallback(() => {
    const turnId = turnIdRef.current;
    if (!turnId) return;
    void cancelCanvasAgentIPC(turnId);
    setAgentText("Stopped.", false);
    endTurn();
  }, [endTurn, setAgentText]);

  return {
    answerQuestion,
    buildContext,
    cancel,
    connectionId,
    connectionIds,
    connectionOptions,
    describeQuery,
    entries,
    pickConnections,
    schemaLoading,
    send,
    streaming,
  };
}

export { useCanvasAgentChat };
