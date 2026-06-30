import { memo } from "react";
import type { NodeProps } from "reactflow";
import { ChartView } from "@domains/chart";

import { useCanvasStore } from "../../../../hooks";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";

/// A chart object bound to a query object by `sourceQueryId`. Renders through the
/// shared ChartView with the upstream query's run result, so it updates whenever
/// that query re-runs. `nowheel` lets the chart scroll/zoom without panning.
function ChartNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
  const board = useCanvasStore((s) => s.boards[tabId]);
  const component = board?.doc.components.find((c) => c.id === id);
  if (!component || component.kind !== "chart") return null;
  const run = component.sourceQueryId ? board?.runs[component.sourceQueryId] : undefined;

  return (
    <>
      <CanvasResizer tabId={tabId} id={id} visible={selected} />
      <div className={`mdbc-canvas-node mdbc-canvas-chart nowheel${selected ? " selected" : ""}`}>
        {component.title ? (
          <div className="mdbc-canvas-node-head">
            <span className="mdbc-canvas-node-title">{component.title}</span>
          </div>
        ) : null}
        <div className="mdbc-canvas-chart-body">
          <ChartView
            spec={component.spec}
            result={run?.result}
            isRunning={run?.running}
            error={run?.error}
            onEdit={() => {}}
          />
        </div>
      </div>
    </>
  );
}

const ChartNode = memo(ChartNodeImpl);

export { ChartNode };
