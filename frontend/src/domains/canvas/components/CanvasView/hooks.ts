import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyNodeChanges } from "reactflow";
import type { Node, NodeChange, Viewport } from "reactflow";

import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";

import { CANVAS_SAVE_DEBOUNCE_MS, DEFAULT_SIZE } from "../../constants";
import { useCanvasStore } from "../../hooks";
import type {
  CanvasComponent,
  CanvasEdge,
  ComponentKind,
  ReorderOp,
  ShapeKind,
} from "../../types";
import { makeComponent, serializeDoc } from "../../utils";
import type { CanvasMode, CanvasNodeData } from "./types";
import {
  hasActiveTextSelection,
  isEditableTarget,
  toFlowEdges,
  toFlowNodes,
  viewportCenterPlacement,
} from "./utils";

const EMPTY_COMPONENTS: CanvasComponent[] = [];
const EMPTY_EDGES: CanvasEdge[] = [];
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/// Drive one canvas board: parse the tab into objects once, mirror them into
/// ReactFlow's node state (positions stay live during drag, structural adds/
/// removes reseed), persist geometry + viewport back to the store, and serialize
/// the board into the tab's text on a short debounce so it survives reopen.
function useCanvas(tab: EditorTab) {
  const tabId = tab.id;
  const board = useCanvasStore((s) => s.boards[tabId]);
  const ensureBoard = useCanvasStore((s) => s.ensureBoard);
  const addComponent = useCanvasStore((s) => s.addComponent);
  const updateComponent = useCanvasStore((s) => s.updateComponent);
  const removeComponent = useCanvasStore((s) => s.removeComponent);
  const copyComponent = useCanvasStore((s) => s.copyComponent);
  const pasteComponent = useCanvasStore((s) => s.pasteComponent);
  const reorderComponent = useCanvasStore((s) => s.reorderComponent);
  const removeEdges = useCanvasStore((s) => s.removeEdges);
  const setViewport = useCanvasStore((s) => s.setViewport);
  const runAllQueries = useCanvasStore((s) => s.runAllQueries);

  // The board pane element, so a freshly added object can be centered in the
  // current viewport (its pixel size is needed to invert ReactFlow's transform).
  const boardRef = useRef<HTMLDivElement>(null);

  // Parse the tab's text into a board exactly once (a re-mount is a no-op).
  useEffect(() => {
    ensureBoard(tabId, tab.text ?? "");
    // Re-parse only when the tab identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  const components = board?.doc.components ?? EMPTY_COMPONENTS;
  const edges = board?.doc.edges ?? EMPTY_EDGES;

  const flowNodes = useMemo(
    () => toFlowNodes(components, tabId),
    [components, tabId],
  );
  const rfEdges = useMemo(() => toFlowEdges(edges, components), [edges, components]);

  const [rfNodes, setRfNodes] = useState<Node<CanvasNodeData>[]>(flowNodes);

  // Reseed local nodes only when the SET of objects changes (add/remove);
  // otherwise keep the live drag positions and just refresh node identity.
  const structuralKey = useMemo(
    () => components.map((c) => `${c.id}:${c.kind}`).sort().join(","),
    [components],
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
      updateComponent(tabId, node.id, { x: node.position.x, y: node.position.y });
    },
    [tabId, updateComponent],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const node of deleted) removeComponent(tabId, node.id);
    },
    [tabId, removeComponent],
  );

  const onMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => setViewport(tabId, viewport),
    [tabId, setViewport],
  );

  // Context-menu object actions, bound to this board.
  const copy = useCallback(
    (id: string) => copyComponent(tabId, id),
    [copyComponent, tabId],
  );
  const paste = useCallback(() => pasteComponent(tabId), [pasteComponent, tabId]);
  const remove = useCallback(
    (id: string) => removeComponent(tabId, id),
    [removeComponent, tabId],
  );
  const reorder = useCallback(
    (id: string, op: ReorderOp) => reorderComponent(tabId, id, op),
    [reorderComponent, tabId],
  );
  const toggleLock = useCallback(
    (id: string) => {
      const comp = components.find((c) => c.id === id);
      if (comp) updateComponent(tabId, id, { locked: !comp.locked });
    },
    [components, updateComponent, tabId],
  );
  const componentById = useCallback(
    (id: string) => components.find((c) => c.id === id),
    [components],
  );

  const removeEdge = useCallback(
    (id: string) => removeEdges(tabId, [id]),
    [removeEdges, tabId],
  );

  // Merge a prop patch into one object (the properties pane writes through here).
  const update = useCallback(
    (id: string, patch: Partial<CanvasComponent>) =>
      updateComponent(tabId, id, patch),
    [updateComponent, tabId],
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
        copyComponent(tabId, selectedComponent.id);
      } else if (key === "v") {
        e.preventDefault();
        pasteComponent(tabId);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tabId, selectedComponent, copyComponent, pasteComponent]);

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
    addComponent(tabId, makeComponent({ kind: "text", ...placementFor("text"), text: "" }));
  }, [addComponent, placementFor, tabId]);

  const addSticky = useCallback(() => {
    addComponent(tabId, makeComponent({ kind: "sticky", ...placementFor("sticky"), text: "" }));
  }, [addComponent, placementFor, tabId]);

  const addShape = useCallback(
    (shape: ShapeKind) => {
      addComponent(tabId, makeComponent({ kind: "shape", shape, ...placementFor("shape") }));
    },
    [addComponent, placementFor, tabId],
  );

  // Manual query objects bind to the canvas's own connection (same one the agent
  // reads), so Run works without any extra wiring.
  const addQuery = useCallback(() => {
    addComponent(
      tabId,
      makeComponent({
        kind: "query",
        ...placementFor("query"),
        connectionId: tab.connectionId ?? null,
        sql: "",
      }),
    );
  }, [addComponent, placementFor, tab.connectionId, tabId]);

  const addChart = useCallback(() => {
    addComponent(tabId, makeComponent({ kind: "chart", ...placementFor("chart") }));
  }, [addComponent, placementFor, tabId]);

  // Run every query object on the board in one click (toolbar "Run all").
  const runAll = useCallback(() => {
    void runAllQueries(tabId);
  }, [runAllQueries, tabId]);

  // A table previews a query object's rows. It starts unbound; the user picks
  // its source query in the properties pane.
  const addTable = useCallback(() => {
    addComponent(tabId, makeComponent({ kind: "table", ...placementFor("table") }));
  }, [addComponent, placementFor, tabId]);

  // Debounced serialize of the live board into the tab's text (persistence).
  const doc = board?.doc;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!doc) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      useTabsStore.getState().updateTab(tabId, { text: serializeDoc(doc) });
    }, CANVAS_SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [doc, tabId]);

  return {
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
