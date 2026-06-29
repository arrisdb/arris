import { memo } from "react";
import type { NodeProps } from "reactflow";
import type { QueryValue } from "@shared";

import { useCanvasStore } from "../../../../hooks";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";

const PREVIEW_ROWS = 50;

/// Render one cell value for the compact result preview.
function cellText(value: QueryValue): string {
  if (!value || value.kind === "null" || value.value == null) return "NULL";
  return String(value.value);
}

/// A SQL object: editable query, a Run button, and a compact result grid. The
/// chart objects bound to it (by `sourceQueryId`) read the same run result.
function QueryNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
  const board = useCanvasStore((s) => s.boards[tabId]);
  const updateComponent = useCanvasStore((s) => s.updateComponent);
  const runQueryComponent = useCanvasStore((s) => s.runQueryComponent);
  const component = board?.doc.components.find((c) => c.id === id);
  if (!component || component.kind !== "query") return null;
  const run = board?.runs[id];

  return (
    <>
      <CanvasResizer tabId={tabId} id={id} visible={selected} />
      <div className={`mdbc-canvas-node mdbc-canvas-query${selected ? " selected" : ""}`}>
      <div className="mdbc-canvas-node-head">
        <span className="mdbc-canvas-node-title">{component.title ?? "Query"}</span>
        <button
          type="button"
          className="mdbc-btn primary text-only mdbc-canvas-run"
          disabled={run?.running}
          onClick={() => void runQueryComponent(tabId, id)}
        >
          {run?.running ? "Running…" : "Run"}
        </button>
      </div>
      <textarea
        className="nodrag nowheel mdbc-canvas-sql"
        value={component.sql}
        spellCheck={false}
        placeholder="SELECT …"
        onChange={(e) => updateComponent(tabId, id, { sql: e.target.value })}
      />
      <div className="nowheel mdbc-canvas-result">
        {run?.error ? (
          <div className="mdbc-canvas-result-error">{run.error}</div>
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
          <div className="mdbc-canvas-result-empty">Run to see results</div>
        )}
      </div>
      </div>
    </>
  );
}

const QueryNode = memo(QueryNodeImpl);

export { QueryNode };
