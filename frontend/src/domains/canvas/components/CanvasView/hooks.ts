import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyNodeChanges } from "reactflow";
import type { Node, NodeChange, Viewport } from "reactflow";


import { extractIpcError, ipcErrorMessage } from "@shared";
import { currentProject, isWebShell, subscribe } from "@shared/api";

import {
  CANVAS_CELL_INGESTED_SERVER_EVENT,
  CANVAS_CHANGED_EVENT,
  CANVAS_CONFLICT_CODE,
  CANVAS_RELOADED_MESSAGE,
  CANVAS_SAVE_DEBOUNCE_MS,
  DEFAULT_SIZE,
} from "../../constants";
import { useCanvasStore } from "../../hooks";
import { getCanvasIPC, saveCanvasIPC } from "../../ipc";
import type {
  CanvasChangedEvent,
  CanvasComponent,
  CanvasDoc,
  CanvasEdge,
  CellIngestedEvent,
  ComponentKind,
  ReorderOp,
  ShapeKind,
} from "../../types";
import { makeComponent, nextQueryTitle, parseDoc } from "../../utils";
import type { CanvasMode, CanvasNodeData } from "./types";
import {
  defaultQueryConnectionId,
  flowEdgesKey,
  flowNodesKey,
  hasActiveTextSelection,
  isEditableTarget,
  toFlowEdges,
  toFlowNodes,
  viewportCenterPlacement,
} from "./utils";

const EMPTY_COMPONENTS: CanvasComponent[] = [];
const EMPTY_EDGES: CanvasEdge[] = [];
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/// Load a board, save edits on a debounce with its revision, and reload when a
/// save conflicts or (in the browser) another writer such as the CLI changes it.
function useCanvasPersistence(boardId: string) {
  const loadBoard = useCanvasStore((s) => s.loadBoard);
  const runAutoRunQueries = useCanvasStore((s) => s.runAutoRunQueries);
  const setRevision = useCanvasStore((s) => s.setRevision);
  const applyIngestDone = useCanvasStore((s) => s.applyIngestDone);
  const doc = useCanvasStore((s) => s.boards[boardId]?.doc);
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The doc object last loaded or saved; any other doc is an unsaved local edit.
  const savedDocRef = useRef<CanvasDoc | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  // Newest revision announced while a save was in flight (our own echo or a rival).
  const announcedRef = useRef(0);

  const reload = useCallback(
    async (droppedEdits: boolean) => {
      const record = await getCanvasIPC(boardId);
      const next = parseDoc(record.doc);
      savedDocRef.current = next;
      loadBoard(boardId, next, record.revision);
      void runAutoRunQueries(boardId);
      setTitle(record.title);
      if (droppedEdits) setNotice(CANVAS_RELOADED_MESSAGE);
    },
    [boardId, loadBoard, runAutoRunQueries],
  );

  useEffect(() => {
    reload(false).catch((e: unknown) => setError(ipcErrorMessage(e)));
  }, [reload]);

  const save = useCallback(async () => {
    const board = useCanvasStore.getState().boards[boardId];
    if (!board || board.doc === savedDocRef.current) return;
    const sending = board.doc;
    announcedRef.current = 0;
    try {
      const record = await saveCanvasIPC(boardId, sending, board.revision);
      savedDocRef.current = sending;
      setRevision(boardId, record.revision);
      if (announcedRef.current > record.revision) {
        await reload(useCanvasStore.getState().boards[boardId]?.doc !== sending);
      }
    } catch (e) {
      if (extractIpcError(e).code === CANVAS_CONFLICT_CODE) await reload(true);
      else setError(ipcErrorMessage(e));
    }
  }, [boardId, reload, setRevision]);

  useEffect(() => {
    if (!doc || doc === savedDocRef.current) return;
    const timer = setTimeout(() => {
      // Chain saves so each one sends the revision the previous one produced.
      const prev = savingRef.current ?? Promise.resolve();
      savingRef.current = prev.then(save).finally(() => {
        savingRef.current = null;
      });
    }, CANVAS_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [doc, save]);

  // The desktop gets ingest totals from a Tauri event registered by the domain.
  useEffect(() => {
    if (!isWebShell()) return;
    return subscribe((event) => {
      if (event.project !== currentProject()) return;
      if (event.kind === CANVAS_CHANGED_EVENT) {
        const changed = event.payload as CanvasChangedEvent;
        const board = useCanvasStore.getState().boards[boardId];
        if (changed.id !== boardId || !board || changed.revision <= board.revision) return;
        if (savingRef.current) {
          announcedRef.current = Math.max(announcedRef.current, changed.revision);
          return;
        }
        void reload(board.doc !== savedDocRef.current);
      } else if (event.kind === CANVAS_CELL_INGESTED_SERVER_EVENT) {
        const done = event.payload as CellIngestedEvent;
        if (done.boardId === boardId) {
          applyIngestDone(boardId, done.cellId, done.totalRows, done.complete);
        }
      }
    });
  }, [applyIngestDone, boardId, reload]);

  return { title, error, notice, dismissNotice: () => setNotice(null) };
}

/// Drive one canvas board: mirror its objects into ReactFlow's node state
/// (positions stay live during drag, structural adds/removes reseed) and write
/// geometry and viewport back to the store. `defaultConnectionId` seeds new
/// query objects when the board has no connection of its own yet.
function useCanvas(boardId: string, defaultConnectionId?: string) {
  const persistence = useCanvasPersistence(boardId);
  const board = useCanvasStore((s) => s.boards[boardId]);
  const addComponent = useCanvasStore((s) => s.addComponent);
  const updateComponent = useCanvasStore((s) => s.updateComponent);
  const removeComponent = useCanvasStore((s) => s.removeComponent);
  const copyComponent = useCanvasStore((s) => s.copyComponent);
  const pasteComponent = useCanvasStore((s) => s.pasteComponent);
  const reorderComponent = useCanvasStore((s) => s.reorderComponent);
  const removeEdges = useCanvasStore((s) => s.removeEdges);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const runAllQueries = useCanvasStore((s) => s.runAllQueries);
  const lastQueryConnection = useCanvasStore((s) => s.lastQueryConnection[boardId]);

  // The board pane element, so a freshly added object can be centered in the
  // current viewport (its pixel size is needed to invert ReactFlow's transform).
  const boardRef = useRef<HTMLDivElement>(null);

  const components = board?.doc.components ?? EMPTY_COMPONENTS;
  const edges = board?.doc.edges ?? EMPTY_EDGES;

  // Keyed on what ReactFlow actually renders, not on `components` identity: a
  // keystroke rewrites SQL, and re-rendering the node then eats the input.
  const nodesKey = flowNodesKey(components);
  const edgesKey = flowEdgesKey(edges, components);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by `nodesKey`
  const flowNodes = useMemo(() => toFlowNodes(components, boardId), [nodesKey, boardId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by `edgesKey`
  const rfEdges = useMemo(() => toFlowEdges(edges, components), [edgesKey]);

  const [rfNodes, setRfNodes] = useState<Node<CanvasNodeData>[]>(flowNodes);

  // Reseed local nodes only when the SET of objects changes (add/remove);
  // otherwise keep the live drag positions and just refresh node identity.
  const structuralKey = useMemo(
    () => flowNodes.map((n) => `${n.id}:${n.type}`).sort().join(","),
    [flowNodes],
  );
  const prevKeyRef = useRef(structuralKey);
  useEffect(() => {
    if (structuralKey !== prevKeyRef.current) {
      prevKeyRef.current = structuralKey;
      setRfNodes(flowNodes);
      return;
    }
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return flowNodes.map((n) => {
        const p = prevById.get(n.id);
        // Keep the live drag position ONLY while a drag is in flight (the store
        // isn't updated until drag-stop); otherwise take the store's position so
        // a pane-driven X/Y edit moves the node. Always keep the live selection/
        // drag flags so a store update never clears the selection and makes the
        // resize anchors blink out.
        return p
          ? {
              ...n,
              position: p.dragging ? p.position : n.position,
              selected: p.selected,
              dragging: p.dragging,
            }
          : n;
      });
    });
  }, [flowNodes, structuralKey]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setRfNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      updateComponent(boardId, node.id, { x: node.position.x, y: node.position.y });
    },
    [boardId, updateComponent],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const node of deleted) removeComponent(boardId, node.id);
    },
    [boardId, removeComponent],
  );

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => setViewport(boardId, viewport),
    [boardId, setViewport],
  );

  // Context-menu object actions, bound to this board.
  const copy = useCallback(
    (id: string) => copyComponent(boardId, id),
    [copyComponent, boardId],
  );
  const paste = useCallback(() => pasteComponent(boardId), [pasteComponent, boardId]);
  const remove = useCallback(
    (id: string) => removeComponent(boardId, id),
    [removeComponent, boardId],
  );
  const reorder = useCallback(
    (id: string, op: ReorderOp) => reorderComponent(boardId, id, op),
    [reorderComponent, boardId],
  );
  const toggleLock = useCallback(
    (id: string) => {
      const comp = components.find((c) => c.id === id);
      if (comp) updateComponent(boardId, id, { locked: !comp.locked });
    },
    [components, updateComponent, boardId],
  );
  const componentById = useCallback(
    (id: string) => components.find((c) => c.id === id),
    [components],
  );

  const removeEdge = useCallback(
    (id: string) => removeEdges(boardId, [id]),
    [removeEdges, boardId],
  );

  // Merge a prop patch into one object (the properties pane writes through here).
  const update = useCallback(
    (id: string, patch: Partial<CanvasComponent>) =>
      updateComponent(boardId, id, patch),
    [updateComponent, boardId],
  );

  // The object whose properties pane is shown: exactly one selected node. Reading
  // the live `selected` flag off the local RF nodes keeps it in sync with the
  // board without a second selection source of truth.
  const selectedIds = useMemo(
    () => rfNodes.filter((n) => n.selected).map((n) => n.id),
    [rfNodes],
  );
  const selectedComponent =
    selectedIds.length === 1
      ? components.find((c) => c.id === selectedIds[0])
      : undefined;

  // Copy (⌘/Ctrl+C) the selected object and Paste (⌘/Ctrl+V) a fresh clone.
  // Skipped while typing in an input, textarea, or code editor so ordinary text
  // copy/paste still works inside a query cell or text block.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "c" && selectedComponent) {
        // A live text selection means the user is copying text (e.g. an agent
        // reply in the side chat), not the selected object: let the browser's
        // native copy run instead of cloning the node.
        if (hasActiveTextSelection()) return;
        e.preventDefault();
        copyComponent(boardId, selectedComponent.id);
      } else if (key === "v") {
        e.preventDefault();
        pasteComponent(boardId);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [boardId, selectedComponent, copyComponent, pasteComponent]);

  // The active pointer tool. `move` drags objects; `hand` pans the board.
  const [mode, setMode] = useState<CanvasMode>("move");

  // Place a manually-added object centered in the current viewport (so it's never
  // lost off-screen after panning), cascaded slightly so repeated adds don't stack.
  const placementFor = useCallback(
    (kind: ComponentKind) => {
      const vp = board?.doc.viewport ?? DEFAULT_VIEWPORT;
      const rect = boardRef.current?.getBoundingClientRect() ?? null;
      const cascade = board?.doc.components.length ?? 0;
      return viewportCenterPlacement(rect, vp, DEFAULT_SIZE[kind], cascade);
    },
    [board],
  );

  const addText = useCallback(() => {
    addComponent(boardId, makeComponent({ kind: "text", ...placementFor("text"), text: "" }));
  }, [addComponent, placementFor, boardId]);

  const addSticky = useCallback(() => {
    addComponent(boardId, makeComponent({ kind: "sticky", ...placementFor("sticky"), text: "" }));
  }, [addComponent, placementFor, boardId]);

  const addShape = useCallback(
    (shape: ShapeKind) => {
      addComponent(boardId, makeComponent({ kind: "shape", shape, ...placementFor("shape") }));
    },
    [addComponent, placementFor, boardId],
  );

  // Binds to the canvas's own connection so Run needs no extra wiring, and gets a
  // default title because that is the name downstream cells reference in `FROM`.
  const addQuery = useCallback(() => {
    addComponent(
      boardId,
      makeComponent({
        kind: "query",
        ...placementFor("query"),
        connectionId: defaultQueryConnectionId(
          components,
          lastQueryConnection,
          board?.doc.connectionIds?.[0] ?? defaultConnectionId,
        ),
        sql: "",
        title: nextQueryTitle(components),
      }),
    );
  }, [addComponent, components, lastQueryConnection, placementFor, board?.doc.connectionIds, defaultConnectionId, boardId]);

  const addChart = useCallback(() => {
    addComponent(boardId, makeComponent({ kind: "chart", ...placementFor("chart") }));
  }, [addComponent, placementFor, boardId]);

  // Run every query object on the board in one click (toolbar "Run all").
  const runAll = useCallback(() => {
    void runAllQueries(boardId);
  }, [runAllQueries, boardId]);

  // A table previews a query object's rows. It starts unbound; the user picks
  // its source query in the properties pane.
  const addTable = useCallback(() => {
    addComponent(boardId, makeComponent({ kind: "table", ...placementFor("table") }));
  }, [addComponent, placementFor, boardId]);

  return {
    ...persistence,
    loaded: Boolean(board),
    boardRef,
    rfNodes,
    rfEdges,
    onNodesChange,
    onNodeDragStop,
    onNodesDelete,
    onMoveEnd,
    mode,
    setMode,
    addText,
    addSticky,
    addShape,
    addQuery,
    addChart,
    addTable,
    runAll,
    copy,
    paste,
    remove,
    reorder,
    toggleLock,
    componentById,
    update,
    selectedComponent,
    removeEdge,
  };
}

export { useCanvas };
