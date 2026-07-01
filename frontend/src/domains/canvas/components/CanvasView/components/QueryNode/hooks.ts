import { useEffect, useRef, type RefObject } from "react";
import { Compartment } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { useConnectionsStore } from "@domains/connection/hooks";

import { useCanvasStore } from "../../../../hooks";
import { buildCanvasSqlSupport, queryEditorExtensions } from "./utils";

interface QueryEditorInput {
  tabId: string;
  id: string;
  connectionId: string | null;
}

/// Mount a CodeMirror SQL editor in `host` for one query object. The editor is
/// uncontrolled (CodeMirror owns the live doc + caret); the store is written per
/// keystroke but the node never feeds the doc back into React, so typing never
/// re-renders the node. External rewrites (the agent editing a query by id) are
/// synced in via a store subscription that only dispatches when the incoming SQL
/// differs from what the editor already holds. Completion reconfigures in place
/// when the connection's schema finishes loading.
function useQueryEditor(host: RefObject<HTMLDivElement | null>, input: QueryEditorInput) {
  const { tabId, id, connectionId } = input;

  // Schema + dialect for completion, read reactively so the editor upgrades from
  // plain highlighting to schema-aware completion once the schema loads.
  const connectionKind = useConnectionsStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.kind,
  );
  const schemaNodes = useConnectionsStore((s) =>
    connectionId ? s.schemaCache[connectionId] : undefined,
  );

  // Completion needs the connection's columns, not just the schema browser's
  // selected subset. Ensure the container list is cached, then deep-load EVERY
  // schema's tables/columns for this connection. Re-runs when the shallow tree
  // first arrives (schemaNodes flips defined); once all schemas are loaded the
  // action no-ops, so the later merges don't loop.
  useEffect(() => {
    if (!connectionId) return;
    const cs = useConnectionsStore.getState();
    cs.ensureSchema(connectionId);
    void cs.loadAllSchemaTables(connectionId);
  }, [connectionId, schemaNodes]);

  const viewRef = useRef<EditorView | null>(null);
  const supportRef = useRef<Compartment | null>(null);

  // Mount once per node. Initial SQL is read at mount via getState (never a prop)
  // so the doc stays out of the render path.
  useEffect(() => {
    if (!host.current) return;
    const support = new Compartment();
    supportRef.current = support;
    const mounted = useCanvasStore
      .getState()
      .boards[tabId]?.doc.components.find((c) => c.id === id);
    const initialSql = mounted?.kind === "query" ? mounted.sql : "";
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialSql,
        extensions: queryEditorExtensions({
          support: support.of(buildCanvasSqlSupport({ connectionKind, schemaNodes })),
          onChange: (value) => useCanvasStore.getState().updateComponent(tabId, id, { sql: value }),
          onRun: () => void useCanvasStore.getState().runQueryComponent(tabId, id),
        }),
      }),
    });
    viewRef.current = view;

    // Sync external SQL rewrites (agent edits a query by id) into the live doc.
    // Plain subscribe is fine: the store has no selector middleware, so recompute
    // the SQL on each change and dispatch only when it actually differs from the
    // editor's current doc, which also prevents our own onChange from looping.
    const unsub = useCanvasStore.subscribe((state) => {
      const comp = state.boards[tabId]?.doc.components.find((c) => c.id === id);
      if (comp?.kind !== "query") return;
      const current = view.state.doc.toString();
      if (comp.sql !== current) {
        view.dispatch({ changes: { from: 0, to: current.length, insert: comp.sql } });
      }
    });

    return () => {
      unsub();
      view.destroy();
      viewRef.current = null;
      supportRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per node; schema is reconfigured below
  }, [tabId, id]);

  // Reconfigure completion when the connection's schema/dialect changes, without
  // remounting (which would drop the caret and undo history).
  useEffect(() => {
    const view = viewRef.current;
    const support = supportRef.current;
    if (!view || !support) return;
    view.dispatch({
      effects: support.reconfigure(buildCanvasSqlSupport({ connectionKind, schemaNodes })),
    });
  }, [connectionKind, schemaNodes]);
}

export { useQueryEditor };
