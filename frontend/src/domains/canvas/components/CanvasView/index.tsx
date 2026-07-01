import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import ReactFlow, { Background, Controls } from "reactflow";
import type { Edge, Node } from "reactflow";
import type { MouseEvent as ReactMouseEvent } from "react";
import "reactflow/dist/style.css";
import "./index.css";

import { ContextMenu, useContextMenu } from "@shared/ui/ContextMenu";
import { useRegisterCommands } from "@shell/utils";

import { CanvasAgentChat } from "../CanvasAgentChat";
import { CanvasPropertiesPane } from "./components/CanvasPropertiesPane";
import { CanvasToolbar } from "./components/CanvasToolbar";
import { useCanvas } from "./hooks";
import type { CanvasViewProps } from "./types";
import { buildEdgeMenuItems, buildNodeMenuItems, edgeTypes, nodeTypes } from "./utils";

/// The canvas thinkboard tab view: an infinite ReactFlow board of objects
/// (text/query/chart/shape) plus a floating add-toolbar. The agent chat panel is
/// rendered alongside the board.
function CanvasView({ activeTab }: CanvasViewProps) {
  const canvas = useCanvas(activeTab);

  // The board's keyboard shortcuts flow through the command registry (so they
  // show up in Settings -> Keymap and are user-rebindable) rather than a private
  // keydown switch. Registered while this canvas tab is mounted; the bare-key
  // bindings are suppressed while typing by the global keymap's typing guard.
  // The toolbar buttons and context menu call these same handlers directly.
  useRegisterCommands({
    canvasMoveTool: { run: () => canvas.setMode("move") },
    canvasHandTool: { run: () => canvas.setMode("hand") },
    canvasAddSqlCell: { run: () => canvas.addQuery() },
    canvasAddRectangle: { run: () => canvas.addShape("rect") },
    canvasAddEllipse: { run: () => canvas.addShape("ellipse") },
    canvasAddLine: { run: () => canvas.addShape("line") },
    canvasBringToFront: {
      run: () => {
        if (canvas.selectedComponent) canvas.reorder(canvas.selectedComponent.id, "front");
      },
      isEnabled: () => Boolean(canvas.selectedComponent),
    },
    canvasSendToBack: {
      run: () => {
        if (canvas.selectedComponent) canvas.reorder(canvas.selectedComponent.id, "back");
      },
      isEnabled: () => Boolean(canvas.selectedComponent),
    },
  });

  const handMode = canvas.mode === "hand";
  const menu = useContextMenu<string>();
  const edgeMenu = useContextMenu<string>();

  const onNodeContextMenu = (event: ReactMouseEvent, node: Node) =>
    menu.open(event, node.id);

  const onEdgeContextMenu = (event: ReactMouseEvent, edge: Edge) => {
    event.preventDefault();
    edgeMenu.open(event, edge.id);
  };

  const menuComponent = menu.state ? canvas.componentById(menu.state.context) : undefined;

  return (
    <div className="mdbc-canvas-view">
      <PanelGroup className="mdbc-canvas-panels" id="canvas-horizontal" direction="horizontal">
        <Panel id="canvas-agent" order={1} defaultSize={18} minSize={12} maxSize={40}>
          {/* Key by tab id so each canvas gets its own chat instance: switching
              to or creating a canvas remounts the panel with that board's chat
              instead of carrying over the previous board's conversation. */}
          <CanvasAgentChat key={activeTab.id} tab={activeTab} />
        </Panel>
        <PanelResizeHandle className="mdbc-canvas-pane-resizer" />
        <Panel id="canvas-board" order={2} minSize={30}>
          <div
            ref={canvas.boardRef}
            className={`mdbc-canvas-board${handMode ? " hand" : ""}`}
          >
            <ReactFlow
              nodes={canvas.rfNodes}
              edges={canvas.rfEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={canvas.onNodesChange}
              onNodeDragStop={canvas.onNodeDragStop}
              onNodesDelete={canvas.onNodesDelete}
              onNodeContextMenu={onNodeContextMenu}
              onEdgeContextMenu={onEdgeContextMenu}
              onMoveEnd={canvas.onMoveEnd}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={2}
              nodesDraggable={canvas.mode === "move"}
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
              onAddTable={canvas.addTable}
              onAddSticky={canvas.addSticky}
              onAddText={canvas.addText}
              onAddShape={canvas.addShape}
              onRunAll={canvas.runAll}
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
      {edgeMenu.state && (
        <ContextMenu
          x={edgeMenu.state.x}
          y={edgeMenu.state.y}
          items={buildEdgeMenuItems(edgeMenu.state.context, { remove: canvas.removeEdge })}
          onClose={edgeMenu.close}
          data-testid="canvas-edge-menu"
        />
      )}
    </div>
  );
}

export { CanvasView };
