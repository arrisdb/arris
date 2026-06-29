import ReactFlow, { Background, Controls } from "reactflow";
import "reactflow/dist/style.css";
import "./index.css";

import { CanvasAgentChat } from "../CanvasAgentChat";
import { CanvasToolbar } from "./components/CanvasToolbar";
import { useCanvas } from "./hooks";
import type { CanvasViewProps } from "./types";
import { nodeTypes } from "./utils";

/// The canvas thinkboard tab view: an infinite ReactFlow board of objects
/// (text/query/chart/shape) plus a floating add-toolbar. The agent chat panel is
/// rendered alongside the board.
function CanvasView({ activeTab }: CanvasViewProps) {
  const canvas = useCanvas(activeTab);
  const handMode = canvas.mode === "hand";
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
    </div>
  );
}

export { CanvasView };
