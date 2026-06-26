import type { SchemaNode, SchemaNodeKind } from "@shared";

const SCHEMA_NODE_DRAG_MIME = "application/x-arris-schema-node";
const SCHEMA_NODE_POINTER_DROP_EVENT = "arris:schema-node-pointer-drop";

const POINTER_DRAG_THRESHOLD_PX = 4;
const GHOST_OFFSET_X = 12;
const GHOST_OFFSET_Y = -8;

let dragGhost: HTMLElement | null = null;
let selectStartHandler: ((e: Event) => void) | null = null;
let activeSchemaDragText: string | null = null;
let activePointerDrag: {
  pointerId: number;
  startX: number;
  startY: number;
  insertText: string;
  moved: boolean;
} | null = null;

const QUERY_DRAGGABLE_SCHEMA_KINDS = new Set<SchemaNodeKind>([
  "table",
  "view",
  "materializedView",
  "foreignTable",
  "collection",
  "elasticsearchIndex",
  "elasticsearchAlias",
  "elasticsearchDataStream",
  "column",
]);

interface SchemaNodeDragPayload {
  kind: SchemaNodeKind;
  path: string;
  name: string;
  insertText: string;
}

interface SchemaNodePointerDropDetail {
  insertText: string;
  clientX: number;
  clientY: number;
}

function isQueryDraggableSchemaNode(node: SchemaNode): boolean {
  return QUERY_DRAGGABLE_SCHEMA_KINDS.has(node.kind);
}

function schemaNodeInsertText(node: SchemaNode): string {
  return node.name;
}

function schemaNodeDragPayload(node: SchemaNode): SchemaNodeDragPayload {
  return {
    kind: node.kind,
    path: node.path,
    name: node.name,
    insertText: schemaNodeInsertText(node),
  };
}

function readSchemaNodeDragText(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer) return activeSchemaDragText;
  const raw = dataTransfer.getData(SCHEMA_NODE_DRAG_MIME);
  if (raw) {
    try {
      const payload = JSON.parse(raw) as Partial<SchemaNodeDragPayload>;
      if (typeof payload.insertText === "string" && payload.insertText.length > 0) {
        return payload.insertText;
      }
    } catch {
      return activeSchemaDragText;
    }
  }
  return activeSchemaDragText;
}

function hasSchemaNodeDragData(dataTransfer: DataTransfer | null): boolean {
  if (activeSchemaDragText) return true;
  return !!dataTransfer && Array.from(dataTransfer.types).includes(SCHEMA_NODE_DRAG_MIME);
}

function showDragGhost(text: string, clientX: number, clientY: number) {
  if (dragGhost) return;
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, {
    position: "fixed",
    left: `${clientX + GHOST_OFFSET_X}px`,
    top: `${clientY + GHOST_OFFSET_Y}px`,
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    fontFamily: "var(--m-font-editor, var(--m-font-mono))",
    background: "var(--m-accent, #7c8cff)",
    color: "#fff",
    pointerEvents: "none",
    zIndex: "99999",
    opacity: "0.92",
    whiteSpace: "nowrap",
  });
  document.body.appendChild(el);
  dragGhost = el;
}

function moveDragGhost(clientX: number, clientY: number) {
  if (!dragGhost) return;
  dragGhost.style.left = `${clientX + GHOST_OFFSET_X}px`;
  dragGhost.style.top = `${clientY + GHOST_OFFSET_Y}px`;
}

function removeDragGhost() {
  document.body.style.userSelect = "";
  document.body.style.webkitUserSelect = "";
  if (selectStartHandler) {
    document.removeEventListener("selectstart", selectStartHandler);
    selectStartHandler = null;
  }
  if (!dragGhost) return;
  dragGhost.remove();
  dragGhost = null;
}

function clearSchemaNodeDragData() {
  activeSchemaDragText = null;
  activePointerDrag = null;
  removeDragGhost();
}

function cancelPointerDrag() {
  activePointerDrag = null;
  removeDragGhost();
}

function beginSchemaNodePointerDrag(
  node: SchemaNode,
  pointerId: number,
  clientX: number,
  clientY: number,
) {
  const insertText = schemaNodeInsertText(node);
  activeSchemaDragText = insertText;
  activePointerDrag = {
    pointerId,
    startX: clientX,
    startY: clientY,
    insertText,
    moved: false,
  };
  document.body.style.userSelect = "none";
  document.body.style.webkitUserSelect = "none";
  if (!selectStartHandler) {
    selectStartHandler = (e: Event) => e.preventDefault();
    document.addEventListener("selectstart", selectStartHandler);
  }
}

function moveSchemaNodePointerDrag(pointerId: number, clientX: number, clientY: number) {
  if (!activePointerDrag || activePointerDrag.pointerId !== pointerId) return;
  const dx = clientX - activePointerDrag.startX;
  const dy = clientY - activePointerDrag.startY;
  if (Math.hypot(dx, dy) >= POINTER_DRAG_THRESHOLD_PX) {
    if (!activePointerDrag.moved) {
      showDragGhost(activePointerDrag.insertText, clientX, clientY);
      window.getSelection()?.removeAllRanges();
    }
    activePointerDrag.moved = true;
  }
  moveDragGhost(clientX, clientY);
}

function endSchemaNodePointerDrag(pointerId: number, clientX: number, clientY: number): boolean {
  if (!activePointerDrag || activePointerDrag.pointerId !== pointerId) return false;
  const { insertText, moved } = activePointerDrag;
  activePointerDrag = null;
  removeDragGhost();
  if (!moved) return false;
  window.dispatchEvent(
    new CustomEvent<SchemaNodePointerDropDetail>(SCHEMA_NODE_POINTER_DROP_EVENT, {
      detail: { insertText, clientX, clientY },
    }),
  );
  activeSchemaDragText = null;
  return true;
}

export {
  QUERY_DRAGGABLE_SCHEMA_KINDS,
  SCHEMA_NODE_DRAG_MIME,
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
  schemaNodeInsertText,
};

export type {
  SchemaNodeDragPayload,
  SchemaNodePointerDropDetail,
};
