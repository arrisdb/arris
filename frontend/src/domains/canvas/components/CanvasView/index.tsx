import ReactFlow, { Background, Controls } from "reactflow";
import type { Node } from "reactflow";
import type { MouseEvent as ReactMouseEvent } from "react";
import "reactflow/dist/style.css";
import "./index.css";

import { ContextMenu, useContextMenu } from "@shared/ui/ContextMenu";

import { CanvasAgentChat } from "../CanvasAgentChat";
import { CanvasToolbar } from "./components/CanvasToolbar";
import { useCanvas } from "./hooks";
import type { CanvasViewProps } from "./types";
import { buildNodeMenuItems, nodeTypes } from "./utils";

/// The canvas thinkboard tab view: an infinite ReactFlow board of objects
/// (text/query/chart/shape) plus a floating add-toolbar. The agent chat panel is
/// rendered alongside the board.
function CanvasView({ activeTab }: CanvasViewProps) {
  const canvas = useCanvas(activeTab);
  const handMode = canvas.mode === "hand";
  const menu = useContextMenu<string>();

  const onNodeContextMenu = (event: ReactMouseEvent, node: Node) =>
    menu.open(event, node.id);

  const menuComponent = menu.state ? canvas.componentById(menu.state.context) : undefined;

  return (
    <div className="mdbc-canvas-view">
      <CanvasAgentChat tab={activeTab} />
      <div className={`mdbc-canvas-board${handMode ? " hand" : ""}`}>
        <ReactFlow
          nodes={canvas.rfNodes}
          edges={canvas.rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={canvas.onNodesChange}
          onNodeDragStop={canvas.onNodeDragStop}
          onNodesDelete={canvas.onNodesDelete}
          onNodeContextMenu={onNodeContextMenu}
          onMoveEnd={canvas.onMoveEnd}
          defaultViewport={canvas.defaultViewport}
          minZoom={0.2}
          maxZoom={2}
          nodesDraggable={!handMode}
          nodesConnectable={false}
          deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} color="rgb(var(--m-overlay-rgb) / 0.06)" />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
        <CanvasToolbar
          mode={canvas.mode}
          onModeChange={canvas.setMode}
          onAddQuery={canvas.addQuery}
          onAddChart={canvas.addChart}
          onAddSticky={canvas.addSticky}
          onAddText={canvas.addText}
          onAddShape={canvas.addShape}
        />
      </div>
      {menu.state && menuComponent && (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          items={buildNodeMenuItems(menuComponent, {
            duplicate: canvas.duplicate,
            reorder: canvas.reorder,
            toggleLock: canvas.toggleLock,
          })}
          onClose={menu.close}
          data-testid="canvas-node-menu"
        />
      )}
    </div>
  );
}

export { CanvasView };
