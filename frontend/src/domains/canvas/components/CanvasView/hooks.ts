import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyNodeChanges } from "reactflow";
import type { Node, NodeChange, Viewport } from "reactflow";

import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";

import { CANVAS_SAVE_DEBOUNCE_MS, LAYOUT_ORIGIN } from "../../constants";
import { useCanvasStore } from "../../hooks";
import type { CanvasComponent, CanvasEdge, ReorderOp, ShapeKind } from "../../types";
import { makeComponent, serializeDoc } from "../../utils";
import type { CanvasMode, CanvasNodeData } from "./types";
import { toFlowEdges, toFlowNodes } from "./utils";

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
  const duplicateComponent = useCanvasStore((s) => s.duplicateComponent);
  const reorderComponent = useCanvasStore((s) => s.reorderComponent);
  const setViewport = useCanvasStore((s) => s.setViewport);

  // Parse the tab's text into a board exactly once (a re-mount is a no-op).
  useEffect(() => {
    ensureBoard(tabId, tab.text ?? "");
    // Re-parse only when the tab identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  const components = board?.doc.components ?? EMPTY_COMPONENTS;
  const edges = board?.doc.edges ?? EMPTY_EDGES;

  const flowNodes = useMemo(() => toFlowNodes(components, tabId), [components, tabId]);
  const rfEdges = useMemo(() => toFlowEdges(edges), [edges]);

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
        // Keep the live drag position AND the current selection/drag flags, so a
        // store update (e.g. a debounced save or a query run) never clears the
        // selection and makes the resize anchors blink out.
        return p
          ? { ...n, position: p.position, selected: p.selected, dragging: p.dragging }
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
  const duplicate = useCallback(
    (id: string) => duplicateComponent(tabId, id),
    [duplicateComponent, tabId],
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

  // The active pointer tool. `move` drags objects; `hand` pans the board.
  const [mode, setMode] = useState<CanvasMode>("move");

  // Cascade manually-added objects so they don't stack exactly on top.
  const placementFor = useCallback(() => {
    const n = (board?.doc.components.length ?? 0) % 8;
    return { x: LAYOUT_ORIGIN.x + n * 24, y: LAYOUT_ORIGIN.y + n * 24 };
  }, [board]);

  const addText = useCallback(() => {
    addComponent(tabId, makeComponent({ kind: "text", ...placementFor(), text: "" }));
  }, [addComponent, placementFor, tabId]);

  const addSticky = useCallback(() => {
    addComponent(tabId, makeComponent({ kind: "sticky", ...placementFor(), text: "" }));
  }, [addComponent, placementFor, tabId]);

  const addShape = useCallback(
    (shape: ShapeKind) => {
      addComponent(tabId, makeComponent({ kind: "shape", shape, ...placementFor() }));
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
        ...placementFor(),
        connectionId: tab.connectionId ?? null,
        sql: "",
      }),
    );
  }, [addComponent, placementFor, tab.connectionId, tabId]);

  const addChart = useCallback(() => {
    addComponent(tabId, makeComponent({ kind: "chart", ...placementFor() }));
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
    rfNodes,
    rfEdges,
    onNodesChange,
    onNodeDragStop,
    onNodesDelete,
    onMoveEnd,
    defaultViewport: board?.doc.viewport ?? DEFAULT_VIEWPORT,
    mode,
    setMode,
    addText,
    addSticky,
    addShape,
    addQuery,
    addChart,
    duplicate,
    reorder,
    toggleLock,
    componentById,
  };
}

export { useCanvas };
