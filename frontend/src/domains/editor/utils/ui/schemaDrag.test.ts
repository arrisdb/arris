import { afterEach, describe, expect, it, vi } from "vitest";
import type { SchemaNode } from "@shared";
import {
  SCHEMA_NODE_POINTER_DROP_EVENT,
  beginSchemaNodePointerDrag,
  cancelPointerDrag,
  clearSchemaNodeDragData,
  endSchemaNodePointerDrag,
  hasSchemaNodeDragData,
  isQueryDraggableSchemaNode,
  moveSchemaNodePointerDrag,
  readSchemaNodeDragText,
  schemaNodeDragPayload,
} from "./schemaDrag";

const tableNode: SchemaNode = {
  name: "orders",
  kind: "table",
  path: "analytics.public.orders",
  children: [],
};

describe("schema drag payload", () => {
  afterEach(() => {
    clearSchemaNodeDragData();
  });

  it("uses the node name as query insertion text", () => {
    expect(schemaNodeDragPayload(tableNode)).toEqual({
      kind: "table",
      path: "analytics.public.orders",
      name: "orders",
      insertText: "orders",
    });
  });

  it("allows table-like nodes and columns to be dragged into query editors", () => {
    expect(isQueryDraggableSchemaNode(tableNode)).toBe(true);
    expect(
      isQueryDraggableSchemaNode({
        ...tableNode,
        kind: "column",
        path: "analytics.public.orders.id",
        name: "id",
      }),
    ).toBe(true);
    expect(
      isQueryDraggableSchemaNode({
        ...tableNode,
        kind: "schema",
        path: "analytics.public",
        name: "public",
      }),
    ).toBe(false);
  });

  it("pointer drag sets active text readable via hasSchemaNodeDragData", () => {
    expect(hasSchemaNodeDragData(null)).toBe(false);
    beginSchemaNodePointerDrag(tableNode, 42, 10, 10);
    expect(hasSchemaNodeDragData(null)).toBe(true);
    expect(readSchemaNodeDragText(null)).toBe("orders");
  });

  it("clearSchemaNodeDragData resets all state", () => {
    beginSchemaNodePointerDrag(tableNode, 42, 10, 10);
    clearSchemaNodeDragData();
    expect(hasSchemaNodeDragData(null)).toBe(false);
    expect(readSchemaNodeDragText(null)).toBeNull();
  });

  it("dispatches pointer fallback drops after meaningful movement", () => {
    const received: unknown[] = [];
    const listener = (event: Event) => {
      received.push((event as CustomEvent).detail);
    };
    window.addEventListener(SCHEMA_NODE_POINTER_DROP_EVENT, listener);

    beginSchemaNodePointerDrag(tableNode, 42, 10, 10);
    moveSchemaNodePointerDrag(42, 30, 12);
    expect(endSchemaNodePointerDrag(42, 100, 50)).toBe(true);

    window.removeEventListener(SCHEMA_NODE_POINTER_DROP_EVENT, listener);
    expect(received).toEqual([{ insertText: "orders", clientX: 100, clientY: 50 }]);
    expect(readSchemaNodeDragText(null)).toBeNull();
  });

  it("does not dispatch pointer fallback drops for clicks", () => {
    const listener = vi.fn();
    window.addEventListener(SCHEMA_NODE_POINTER_DROP_EVENT, listener);

    beginSchemaNodePointerDrag(tableNode, 42, 10, 10);
    moveSchemaNodePointerDrag(42, 11, 11);
    expect(endSchemaNodePointerDrag(42, 11, 11)).toBe(false);

    window.removeEventListener(SCHEMA_NODE_POINTER_DROP_EVENT, listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it("cancelPointerDrag preserves activeSchemaDragText for native drop fallback", () => {
    beginSchemaNodePointerDrag(tableNode, 42, 10, 10);
    expect(hasSchemaNodeDragData(null)).toBe(true);

    cancelPointerDrag();

    expect(hasSchemaNodeDragData(null)).toBe(true);
    expect(readSchemaNodeDragText(null)).toBe("orders");
    expect(endSchemaNodePointerDrag(42, 100, 50)).toBe(false);
  });
});
