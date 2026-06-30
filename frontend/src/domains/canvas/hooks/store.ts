import { create } from "zustand";

import type {
  AgentCanvasSpec,
  CanvasComponent,
  CanvasDoc,
  CanvasEdge,
  CanvasViewport,
  QueryRunState,
  ReorderOp,
} from "../types";
import { genId, parseDoc, specToBoard } from "../utils";
import { runCanvasQueryIPC } from "../ipc";

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
  /// Clone an object (new id, offset, raised to the top) and append it.
  duplicateComponent: (tabId: string, id: string) => void;
  /// Restack an object relative to its peers (Bring to front / forward, etc.).
  reorderComponent: (tabId: string, id: string, op: ReorderOp) => void;
  setEdges: (tabId: string, edges: CanvasEdge[]) => void;
  setViewport: (tabId: string, viewport: CanvasViewport) => void;
  /// Append agent-generated objects, binding query objects to `connectionId`.
  /// Returns the ids of the query objects added, so the caller can run them.
  applyAgentSpec: (
    tabId: string,
    spec: AgentCanvasSpec,
    connectionId: string | null,
  ) => string[];
  setRun: (tabId: string, id: string, run: QueryRunState) => void;
  /// Execute a query object and store its result/error in `runs`.
  runQueryComponent: (tabId: string, id: string) => Promise<void>;
  removeBoard: (tabId: string) => void;
}

/// Normalize any thrown value into a readable message.
function errToString(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
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
      boards: withDoc(s.boards, tabId, (doc) => ({
        ...doc,
        components: doc.components.map((c) =>
          c.id === id ? ({ ...c, ...patch } as CanvasComponent) : c,
        ),
      })),
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

  duplicateComponent: (tabId, id) =>
    set((s) => {
      const board = s.boards[tabId];
      const src = board?.doc.components.find((c) => c.id === id);
      if (!board || !src) return s;
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

  applyAgentSpec: (tabId, spec, connectionId) => {
    const board = get().boards[tabId];
    if (!board) return [];
    const { components, edges } = specToBoard(
      spec,
      board.doc.components,
      connectionId,
    );
    set((s) => ({
      boards: withDoc(s.boards, tabId, (doc) => ({
        ...doc,
        components: [...doc.components, ...components],
        edges: [...doc.edges, ...edges],
      })),
    }));
    return components.filter((c) => c.kind === "query").map((c) => c.id);
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

  runQueryComponent: async (tabId, id) => {
    const board = get().boards[tabId];
    const comp = board?.doc.components.find((c) => c.id === id);
    if (!comp || comp.kind !== "query") return;
    if (!comp.connectionId) {
      get().setRun(tabId, id, { error: "Pick a connection for this query object." });
      return;
    }
    if (!comp.sql.trim()) {
      get().setRun(tabId, id, { error: "This query object is empty." });
      return;
    }
    get().setRun(tabId, id, { running: true });
    try {
      const result = await runCanvasQueryIPC(comp.connectionId, comp.sql);
      get().setRun(tabId, id, { running: false, result });
    } catch (e) {
      get().setRun(tabId, id, { running: false, error: errToString(e) });
    }
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
