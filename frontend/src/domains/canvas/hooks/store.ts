import { create } from "zustand";

import type {
  AgentCanvasSpec,
  CanvasComponent,
  CanvasDoc,
  CanvasEdge,
  CanvasViewport,
  ChatEntry,
  QueryComponent,
  QueryRunState,
  ReorderOp,
} from "../types";
import {
  CANVAS_QUERY_ID_PREFIX,
  DEFAULT_QUERY_LIMIT,
  DEFAULT_SIZE,
  LAYOUT_GAP,
} from "../constants";
import {
  deriveDataEdges,
  genId,
  makeComponent,
  makeEdge,
  parseDoc,
  planAgentChanges,
} from "../utils";
import { cancelCanvasCellIPC, runCanvasCellIPC } from "../ipc";

interface BoardState {
  doc: CanvasDoc;
  /// Runtime query results, keyed by query-object id. Never serialized.
  runs: Record<string, QueryRunState>;
}

interface CanvasStore {
  boards: Record<string, BoardState>;
  /// Parse a tab's text into a board the first time it mounts; a no-op afterward
  /// so live edits are never clobbered by a re-mount.
  ensureBoard: (tabId: string, text: string) => void;
  addComponent: (tabId: string, component: CanvasComponent) => void;
  /// Merge a patch into one object (geometry from drag/resize, or prop edits).
  updateComponent: (
    tabId: string,
    id: string,
    patch: Partial<CanvasComponent>,
  ) => void;
  removeComponent: (tabId: string, id: string) => void;
  /// A snapshot of an object placed on the in-app clipboard by Copy (⌘C), for a
  /// later Paste (⌘V). Held in memory, not the OS clipboard; never serialized.
  clipboard: CanvasComponent | null;
  /// Copy one object onto the clipboard.
  copyComponent: (tabId: string, id: string) => void;
  /// Paste the clipboard object into a board as a new object (new id, offset,
  /// raised to the top). No-op when the clipboard is empty.
  pasteComponent: (tabId: string) => void;
  /// Restack an object relative to its peers (Bring to front / forward, etc.).
  reorderComponent: (tabId: string, id: string, op: ReorderOp) => void;
  setEdges: (tabId: string, edges: CanvasEdge[]) => void;
  /// Connect two objects with a directed arrow (the user draws relationships in
  /// connect mode). No-op for a self-link or a duplicate of an existing arrow.
  addEdge: (tabId: string, source: string, target: string) => void;
  /// Remove arrows by id (deleting one from its right-click menu).
  removeEdges: (tabId: string, ids: string[]) => void;
  setViewport: (tabId: string, viewport: CanvasViewport) => void;
  /// Set the connections the agent may use for this board (persisted in the doc).
  /// The first id is the board's primary connection (the default for new query
  /// objects); the agent reads every listed connection's schema.
  setConnectionIds: (tabId: string, ids: string[]) => void;
  /// Persist the agent chat log into the board doc (so it survives close/reopen
  /// and restart). The hook keeps the live, per-token entries in local state and
  /// calls this only at turn boundaries, so streaming never thrashes the doc.
  setChat: (tabId: string, chat: ChatEntry[]) => void;
  /// Wipe the board's chat log (the Clear button). Empties the persisted history.
  clearChat: (tabId: string) => void;
  /// Apply one agent turn against the board: add new objects, patch objects the
  /// agent re-addressed by id, and remove the ids it listed. New query objects
  /// bind to `connectionId`. Returns the ids of query objects to (re)run.
  applyAgentSpec: (
    tabId: string,
    spec: AgentCanvasSpec,
    connectionId: string | null,
  ) => string[];
  setRun: (tabId: string, id: string, run: QueryRunState) => void;
  /// Land a cell's full-ingest totals from the `canvas://cell-ingested` event,
  /// clearing the spinner the early page left running.
  applyIngestDone: (
    tabId: string,
    id: string,
    totalRows: number,
    complete: boolean,
  ) => void;
  /// Execute a query object and store its result/error in `runs`.
  runQueryComponent: (tabId: string, id: string) => Promise<void>;
  /// Ask the backend to cancel a query object's in-flight run. The awaited run
  /// call resolves with per-cell "cancelled" errors, which clear the spinner.
  cancelQueryComponent: (tabId: string, id: string) => void;
  /// Run every query object on the board. Only the sink cells (those no other
  /// cell reads) are dispatched; the backend auto-runs each sink's upstream
  /// dependencies, so a shared upstream runs once rather than once per dependent.
  runAllQueries: (tabId: string) => Promise<void>;
  removeBoard: (tabId: string) => void;
}

/// Normalize any thrown value into a readable message. Tauri rejects IPC with a
/// plain `{ code, message }` object (not an Error), so pull `message` out rather
/// than stringifying the object into a useless "[object Object]".
/// Backend cancellation handle for a cell's run, derived (never stored).
function cellQueryId(tabId: string, id: string): string {
  return `${CANVAS_QUERY_ID_PREFIX}:${tabId}:${id}`;
}

function errToString(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/// Recompute z-order after restacking one object relative to its peers. Objects
/// are sorted by current z, the target moved one step (or to an end), then z is
/// renumbered densely from 0 so the order is always well-defined.
function restack(
  components: CanvasComponent[],
  id: string,
  op: ReorderOp,
): CanvasComponent[] {
  const order = [...components].sort((a, b) => a.z - b.z);
  const i = order.findIndex((c) => c.id === id);
  if (i < 0) return components;
  if (op === "front") order.push(...order.splice(i, 1));
  else if (op === "back") order.unshift(...order.splice(i, 1));
  else if (op === "forward" && i < order.length - 1)
    [order[i], order[i + 1]] = [order[i + 1], order[i]];
  else if (op === "backward" && i > 0)
    [order[i], order[i - 1]] = [order[i - 1], order[i]];
  const zById = new Map(order.map((c, idx) => [c.id, idx]));
  return components.map((c) => ({ ...c, z: zById.get(c.id) ?? c.z }));
}

/// Place a preview table to the right of a query the first time it runs, bound by
/// `sourceQueryId` and joined with an arrow, so the user sees the rows without
/// adding a table object by hand. No-op once any table is already bound to the
/// query (so a second run never piles on duplicates).
function withPreviewTable(doc: CanvasDoc, queryId: string): CanvasDoc {
  const query = doc.components.find((c) => c.id === queryId);
  if (!query || query.kind !== "query") return doc;
  // Skip if the query already has a viewer (a table OR a chart) bound to it: the
  // user added one, or the agent built a chart for it, so don't pile on a table.
  const hasViewer = doc.components.some(
    (c) =>
      (c.kind === "table" || c.kind === "chart") && c.sourceQueryId === queryId,
  );
  if (hasViewer) return doc;
  const maxZ = doc.components.reduce((m, c) => Math.max(m, c.z), 0);
  const size = DEFAULT_SIZE.table;
  const table = makeComponent({
    kind: "table",
    sourceQueryId: queryId,
    x: query.x + query.w + LAYOUT_GAP,
    y: query.y,
    w: size.w,
    h: size.h,
    z: maxZ + 1,
    title: query.title ? `${query.title} results` : "Results",
  });
  return {
    ...doc,
    components: [...doc.components, table],
    edges: [...doc.edges, makeEdge(queryId, table.id)],
  };
}

/// Keep a viewer's inbound binding arrow in sync with its `sourceQueryId`: drop
/// the edge from the previous source and add one from the new source. Any other
/// arrow (manual relationship, query-to-query dependency) is left untouched.
function reconcileBindingEdge(
  edges: CanvasEdge[],
  targetId: string,
  prevSource: string | null,
  nextSource: string | null,
): CanvasEdge[] {
  if (prevSource === nextSource) return edges;
  const kept = edges.filter((e) => !(e.target === targetId && e.source === prevSource));
  if (!nextSource) return kept;
  if (kept.some((e) => e.source === nextSource && e.target === targetId)) return kept;
  return [...kept, makeEdge(nextSource, targetId)];
}

/// Replace the doc of one board, leaving its runtime results in place.
function withDoc(
  boards: Record<string, BoardState>,
  tabId: string,
  next: (doc: CanvasDoc) => CanvasDoc,
): Record<string, BoardState> {
  const board = boards[tabId];
  if (!board) return boards;
  return { ...boards, [tabId]: { ...board, doc: next(board.doc) } };
}

const useCanvasStore = create<CanvasStore>((set, get) => ({
  boards: {},
  clipboard: null,

  ensureBoard: (tabId, text) =>
    set((s) =>
      s.boards[tabId]
        ? s
        : { boards: { ...s.boards, [tabId]: { doc: parseDoc(text), runs: {} } } },
    ),

  addComponent: (tabId, component) =>
    set((s) => ({
      boards: withDoc(s.boards, tabId, (doc) => ({
        ...doc,
        components: [...doc.components, component],
      })),
    })),

  updateComponent: (tabId, id, patch) =>
    set((s) => ({
      boards: withDoc(s.boards, tabId, (doc) => {
        const components = doc.components.map((c) =>
          c.id === id ? ({ ...c, ...patch } as CanvasComponent) : c,
        );
        // Binding a viewer to a query (via the properties picker) draws the arrow
        // that the run-time preview-table path draws automatically.
        if (!("sourceQueryId" in patch)) return { ...doc, components };
        const prev = doc.components.find((c) => c.id === id);
        const prevSource =
          prev && (prev.kind === "table" || prev.kind === "chart") ? prev.sourceQueryId : null;
        const nextSource = (patch as { sourceQueryId?: string | null }).sourceQueryId ?? null;
        return { ...doc, components, edges: reconcileBindingEdge(doc.edges, id, prevSource, nextSource) };
      }),
    })),

  removeComponent: (tabId, id) =>
    set((s) => {
      const board = s.boards[tabId];
      if (!board) return s;
      const { [id]: _dropped, ...runs } = board.runs;
      return {
        boards: {
          ...s.boards,
          [tabId]: {
            doc: {
              ...board.doc,
              components: board.doc.components.filter((c) => c.id !== id),
              edges: board.doc.edges.filter(
                (e) => e.source !== id && e.target !== id,
              ),
            },
            runs,
          },
        },
      };
    }),

  copyComponent: (tabId, id) =>
    set((s) => {
      const src = s.boards[tabId]?.doc.components.find((c) => c.id === id);
      return src ? { clipboard: { ...src } } : s;
    }),

  pasteComponent: (tabId) =>
    set((s) => {
      const src = s.clipboard;
      const board = s.boards[tabId];
      if (!src || !board) return s;
      const maxZ = board.doc.components.reduce((m, c) => Math.max(m, c.z), 0);
      const clone = {
        ...src,
        id: genId(src.kind),
        x: src.x + 24,
        y: src.y + 24,
        z: maxZ + 1,
      } as CanvasComponent;
      return {
        boards: withDoc(s.boards, tabId, (doc) => ({
          ...doc,
          components: [...doc.components, clone],
        })),
      };
    }),

  reorderComponent: (tabId, id, op) =>
    set((s) => ({
      boards: withDoc(s.boards, tabId, (doc) => ({
        ...doc,
        components: restack(doc.components, id, op),
      })),
    })),

  setEdges: (tabId, edges) =>
    set((s) => ({
      boards: withDoc(s.boards, tabId, (doc) => ({ ...doc, edges })),
    })),

  setViewport: (tabId, viewport) =>
    set((s) => ({
      boards: withDoc(s.boards, tabId, (doc) => ({ ...doc, viewport })),
    })),

  setConnectionIds: (tabId, ids) =>
    set((s) => ({
      boards: withDoc(s.boards, tabId, (doc) => ({ ...doc, connectionIds: ids })),
    })),

  // `withDoc` keeps the `components`/`edges` array references intact, so writing
  // chat never re-renders the board nodes (their selectors read those arrays),
  // only the chat panel and the persistence effect.
  setChat: (tabId, chat) =>
    set((s) => ({
      boards: withDoc(s.boards, tabId, (doc) => ({ ...doc, chat })),
    })),

  clearChat: (tabId) =>
    set((s) => ({
      boards: withDoc(s.boards, tabId, (doc) => ({ ...doc, chat: [] })),
    })),

  addEdge: (tabId, source, target) =>
    set((s) => {
      const board = s.boards[tabId];
      if (!board || source === target) return s;
      const exists = board.doc.edges.some(
        (e) => e.source === source && e.target === target,
      );
      if (exists) return s;
      const edge: CanvasEdge = { id: genId("edge"), source, target };
      return {
        boards: withDoc(s.boards, tabId, (doc) => ({
          ...doc,
          edges: [...doc.edges, edge],
        })),
      };
    }),

  removeEdges: (tabId, ids) =>
    set((s) => {
      const drop = new Set(ids);
      return {
        boards: withDoc(s.boards, tabId, (doc) => ({
          ...doc,
          edges: doc.edges.filter((e) => !drop.has(e.id)),
        })),
      };
    }),

  applyAgentSpec: (tabId, spec, connectionId) => {
    const board = get().boards[tabId];
    if (!board) return [];
    const { created, updates, removeIds, edges } = planAgentChanges(
      spec,
      board.doc.components,
      connectionId,
    );
    const removed = new Set(removeIds);
    const patchById = new Map(updates.map((u) => [u.id, u.patch]));
    set((s) => {
      const cur = s.boards[tabId];
      if (!cur) return s;
      const runs = { ...cur.runs };
      for (const id of removeIds) delete runs[id];
      const components = cur.doc.components
        .filter((c) => !removed.has(c.id))
        .map((c) => {
          const patch = patchById.get(c.id);
          return patch ? ({ ...c, ...patch } as CanvasComponent) : c;
        })
        .concat(created);
      const existingEdgeKeys = new Set(
        cur.doc.edges.map((e) => `${e.source}->${e.target}`),
      );
      const edgesNext = cur.doc.edges
        .filter((e) => !removed.has(e.source) && !removed.has(e.target))
        .concat(edges.filter((e) => !existingEdgeKeys.has(`${e.source}->${e.target}`)));
      return {
        boards: {
          ...s.boards,
          [tabId]: { doc: { ...cur.doc, components, edges: edgesNext }, runs },
        },
      };
    });
    // Re-run query objects the turn created or whose SQL or connection it changed;
    // charts read their source's cached result, so they need no run of their own.
    const createdQueryIds = created
      .filter((c) => c.kind === "query")
      .map((c) => c.id);
    const changedQueryIds = updates
      .filter((u) => "sql" in u.patch || "connectionId" in u.patch)
      .map((u) => u.id)
      .filter((id) =>
        board.doc.components.some((c) => c.id === id && c.kind === "query"),
      );
    return [...createdQueryIds, ...changedQueryIds];
  },

  setRun: (tabId, id, run) =>
    set((s) => {
      const board = s.boards[tabId];
      if (!board) return s;
      return {
        boards: {
          ...s.boards,
          [tabId]: { ...board, runs: { ...board.runs, [id]: run } },
        },
      };
    }),

  applyIngestDone: (tabId, id, totalRows, complete) => {
    const run = get().boards[tabId]?.runs[id];
    if (!run) return;
    get().setRun(tabId, id, {
      ...run,
      totalRows,
      complete,
      running: false,
      endedAt: Date.now(),
    });
  },

  runQueryComponent: async (tabId, id) => {
    const board = get().boards[tabId];
    const comp = board?.doc.components.find((c) => c.id === id);
    if (!board || !comp || comp.kind !== "query") return;
    if (!comp.sql.trim()) {
      get().setRun(tabId, id, { error: "This query object is empty." });
      return;
    }
    // Snapshot every query cell so the backend can resolve title references and
    // auto-run this cell's upstream dependencies before the target.
    const cells = board.doc.components
      .filter((c): c is QueryComponent => c.kind === "query")
      .map((c) => ({
        id: c.id,
        title: c.title ?? "",
        sql: c.sql,
        connectionId: c.connectionId,
        limit: c.selectAll ? null : (c.limit ?? DEFAULT_QUERY_LIMIT),
      }));
    const queryId = cellQueryId(tabId, id);
    get().setRun(tabId, id, { running: true, startedAt: Date.now() });
    try {
      const runs = await runCanvasCellIPC(tabId, id, cells, queryId);
      const now = Date.now();
      // Apply each executed cell's outcome (target + its upstream dependencies).
      // `startedAt` is carried from the running snapshot; `endedAt` stamps the
      // settle so the status can show total time + last-execution timestamp.
      for (const r of runs) {
        const prev = get().boards[tabId]?.runs[r.id];
        const startedAt = prev?.startedAt;
        if (r.error) {
          get().setRun(tabId, r.id, { error: r.error, startedAt, endedAt: now });
          continue;
        }
        if (r.totalRows === undefined) {
          // Early page: totals arrive via `canvas://cell-ingested`. Keep the
          // spinner unless the event already landed.
          const settled = prev?.running === false && prev.totalRows !== undefined;
          get().setRun(
            tabId,
            r.id,
            settled
              ? {
                  result: r.result,
                  totalRows: prev.totalRows,
                  complete: prev.complete,
                  running: false,
                  startedAt,
                  endedAt: prev.endedAt ?? now,
                }
              : { result: r.result, running: true, startedAt },
          );
          continue;
        }
        get().setRun(tabId, r.id, {
          result: r.result,
          totalRows: r.totalRows,
          complete: r.complete,
          startedAt,
          endedAt: now,
        });
      }
      const targetOk = runs.some((r) => r.id === id && r.result);
      // The cell the user ran gets a preview table on first success; the
      // query-to-query arrows are re-derived from the current SQL references.
      set((s) => ({
        boards: withDoc(s.boards, tabId, (doc) => {
          const next = targetOk ? withPreviewTable(doc, id) : doc;
          return { ...next, edges: deriveDataEdges(next.components, next.edges) };
        }),
      }));
    } catch (e) {
      const startedAt = get().boards[tabId]?.runs[id]?.startedAt;
      get().setRun(tabId, id, {
        running: false,
        error: errToString(e),
        startedAt,
        endedAt: Date.now(),
      });
    }
  },

  cancelQueryComponent: (tabId, id) => {
    if (!get().boards[tabId]?.runs[id]?.running) return;
    // Fire-and-forget: the awaited runQueryComponent call applies the
    // cancelled outcome; a failed cancel changes nothing.
    cancelCanvasCellIPC(cellQueryId(tabId, id)).catch(() => {});
  },

  runAllQueries: async (tabId) => {
    const board = get().boards[tabId];
    if (!board) return;
    const queries = board.doc.components.filter(
      (c): c is QueryComponent => c.kind === "query",
    );
    if (queries.length === 0) return;
    // Dispatch only sinks: query cells that are not read by another query cell.
    // Every cell is either a sink or an ancestor of one, so the backend's
    // upstream auto-run covers the whole board without re-running shared
    // upstreams once per dependent.
    const queryIds = new Set(queries.map((c) => c.id));
    const upstream = new Set(
      deriveDataEdges(board.doc.components, board.doc.edges)
        .filter((e) => queryIds.has(e.source) && queryIds.has(e.target))
        .map((e) => e.source),
    );
    const sinks = queries.filter((c) => !upstream.has(c.id));
    await Promise.all(sinks.map((c) => get().runQueryComponent(tabId, c.id)));
  },

  removeBoard: (tabId) =>
    set((s) => {
      if (!s.boards[tabId]) return s;
      const next = { ...s.boards };
      delete next[tabId];
      return { boards: next };
    }),
}));

export { useCanvasStore };
