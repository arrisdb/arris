import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import ReactFlow, { Background, Controls } from "reactflow";
import type { Node } from "reactflow";
import type { MouseEvent as ReactMouseEvent } from "react";
import "reactflow/dist/style.css";
import "./index.css";

import { ContextMenu, useContextMenu } from "@shared/ui/ContextMenu";

import { CanvasAgentChat } from "../CanvasAgentChat";
import { CanvasPropertiesPane } from "./components/CanvasPropertiesPane";
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
      <PanelGroup className="mdbc-canvas-panels" id="canvas-horizontal" direction="horizontal">
        <Panel id="canvas-agent" order={1} defaultSize={18} minSize={12} maxSize={40}>
          <CanvasAgentChat tab={activeTab} />
        </Panel>
        <PanelResizeHandle className="mdbc-canvas-pane-resizer" />
        <Panel id="canvas-board" order={2} minSize={30}>
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
        </Panel>
        {canvas.selectedComponent && (
          <>
            <PanelResizeHandle className="mdbc-canvas-pane-resizer" />
            <Panel id="canvas-props" order={3} defaultSize={18} minSize={12} maxSize={40}>
              <CanvasPropertiesPane
                tabId={activeTab.id}
                component={canvas.selectedComponent}
                onChange={(patch) => canvas.update(canvas.selectedComponent!.id, patch)}
              />
            </Panel>
          </>
        )}
      </PanelGroup>
      {menu.state && menuComponent && (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          items={buildNodeMenuItems(menuComponent, {
            copy: canvas.copy,
            paste: canvas.paste,
            reorder: canvas.reorder,
            toggleLock: canvas.toggleLock,
            remove: canvas.remove,
          })}
          onClose={menu.close}
          data-testid="canvas-node-menu"
        />
      )}
    </div>
  );
}

export { CanvasView };
