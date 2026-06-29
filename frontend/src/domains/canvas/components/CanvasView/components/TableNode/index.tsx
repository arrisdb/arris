import { memo } from "react";
import type { NodeProps } from "reactflow";
import type { QueryValue } from "@shared";

import { useCanvasStore } from "../../../../hooks";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";
import { PREVIEW_ROWS } from "./constants";

/// Render one cell value for the result grid.
function cellText(value: QueryValue): string {
  if (!value || value.kind === "null" || value.value == null) return "NULL";
  return String(value.value);
}

/// A data table bound to a query object by `sourceQueryId`. Renders the upstream
/// query's run result as a scrollable grid, so it updates whenever that query
/// re-runs. The query object itself shows no inline rows; this is where the data
/// is previewed. `nowheel` lets the grid scroll without panning the board.
function TableNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
  const board = useCanvasStore((s) => s.boards[tabId]);
  const component = board?.doc.components.find((c) => c.id === id);
  if (!component || component.kind !== "table") return null;
  const run = board?.runs[component.sourceQueryId];

  return (
    <>
      <CanvasResizer tabId={tabId} id={id} visible={selected} />
      <div className={`mdbc-canvas-node mdbc-canvas-table${selected ? " selected" : ""}`}>
        {component.title ? (
          <div className="mdbc-canvas-node-head">
            <span className="mdbc-canvas-node-title">{component.title}</span>
          </div>
        ) : null}
        <div className="nowheel mdbc-canvas-result">
          {run?.error ? (
            <div className="mdbc-canvas-result-error">{run.error}</div>
          ) : run?.running ? (
            <div className="mdbc-canvas-result-empty">Running…</div>
          ) : run?.result ? (
            <table className="mdbc-canvas-result-table">
              <thead>
                <tr>
                  {run.result.columns.map((col) => (
                    <th key={col.name}>{col.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {run.result.rows.slice(0, PREVIEW_ROWS).map((row, ri) => (
                  <tr key={ri}>
                    {row.map((value, ci) => (
                      <td key={ci}>{cellText(value)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="mdbc-canvas-result-empty">
              {component.sourceQueryId
                ? "Run the source query to see results"
                : "Pick a source query"}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const TableNode = memo(TableNodeImpl);

export { TableNode };
