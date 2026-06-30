import { memo, useRef } from "react";
import type { NodeProps } from "reactflow";
import type { QueryValue } from "@shared";

import { useCanvasStore } from "../../../../hooks";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";
import { PREVIEW_ROWS } from "./constants";
import { useQueryEditor } from "./hooks";

/// Render one cell value for the compact result preview.
function cellText(value: QueryValue): string {
  if (!value || value.kind === "null" || value.value == null) return "NULL";
  return String(value.value);
}

/// A SQL object: a schema-aware CodeMirror editor (same dialect + completion as
/// the main editor), a Run button, and a compact result grid. The chart objects
/// bound to it (by `sourceQueryId`) read the same run result.
///
/// Selectors are kept narrow (title, connection, run state) so a keystroke, which
/// writes the SQL to the store, never re-renders the node: the editor is
/// uncontrolled and owns the live doc (see `useQueryEditor`).
function QueryNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
  const isQuery = useCanvasStore((s) => {
    const c = s.boards[tabId]?.doc.components.find((c) => c.id === id);
    return c?.kind === "query";
  });
  const title = useCanvasStore((s) => {
    const c = s.boards[tabId]?.doc.components.find((c) => c.id === id);
    return c?.kind === "query" ? c.title ?? "Query" : null;
  });
  const connectionId = useCanvasStore((s) => {
    const c = s.boards[tabId]?.doc.components.find((c) => c.id === id);
    return c?.kind === "query" ? c.connectionId : null;
  });
  const run = useCanvasStore((s) => s.boards[tabId]?.runs[id]);
  const runQueryComponent = useCanvasStore((s) => s.runQueryComponent);

  const hostRef = useRef<HTMLDivElement | null>(null);
  useQueryEditor(hostRef, { tabId, id, connectionId });

  if (!isQuery) return null;

  return (
    <>
      <CanvasResizer tabId={tabId} id={id} visible={selected} />
      <div className={`mdbc-canvas-node mdbc-canvas-query${selected ? " selected" : ""}`}>
        <div className="mdbc-canvas-node-head">
          <span className="mdbc-canvas-node-title">{title}</span>
          <button
            type="button"
            className="mdbc-btn primary text-only mdbc-canvas-run"
            disabled={run?.running}
            onClick={() => void runQueryComponent(tabId, id)}
          >
            {run?.running ? "Running…" : "Run"}
          </button>
        </div>
        <div ref={hostRef} className="nodrag nowheel mdbc-canvas-sql" />
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
