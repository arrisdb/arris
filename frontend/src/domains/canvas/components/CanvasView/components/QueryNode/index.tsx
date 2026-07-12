import { memo, useRef } from "react";
import type { NodeProps } from "reactflow";

import { DatabaseKindIcon } from "@domains/connection";
import { useConnectionsStore } from "@domains/connection/hooks";
import { IconButton } from "@shared/ui/IconButton";

import { useCanvasStore } from "../../../../hooks";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";
import { useQueryEditor } from "./hooks";
import { runResultSummary, runStreamingSummary } from "./utils";

/// A SQL object: a schema-aware CodeMirror editor (same dialect + completion as
/// the main editor), a Run button, and a one-line run status. It holds no result
/// grid: the table and chart objects bound to it (by `sourceQueryId`) read its
/// run result and render the rows.
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
  const connection = useConnectionsStore((s) =>
    connectionId ? s.connections.find((c) => c.id === connectionId) ?? null : null,
  );
  const run = useCanvasStore((s) => s.boards[tabId]?.runs[id]);
  const runQueryComponent = useCanvasStore((s) => s.runQueryComponent);
  const cancelQueryComponent = useCanvasStore((s) => s.cancelQueryComponent);

  const hostRef = useRef<HTMLDivElement | null>(null);
  useQueryEditor(hostRef, { tabId, id, connectionId });

  if (!isQuery) return null;

  return (
    <>
      <CanvasResizer tabId={tabId} id={id} visible={selected} />
      <div className={`mdbc-canvas-node mdbc-canvas-query${selected ? " selected" : ""}`}>
        <div className="mdbc-canvas-node-head">
          <span className="mdbc-canvas-node-title">{title}</span>
          <div className="mdbc-canvas-node-head-right">
            {connection && (
              <span className="mdbc-canvas-conn" title={connection.name}>
                <DatabaseKindIcon kind={connection.kind} size={14} />
                <span className="mdbc-canvas-conn-name">{connection.name}</span>
              </span>
            )}
            <span className="mdbc-canvas-head-sep" />
            {run?.running ? (
              <IconButton
                icon="square"
                label="Cancel"
                variant="danger"
                size={14}
                className="mdbc-canvas-run"
                onClick={() => cancelQueryComponent(tabId, id)}
              />
            ) : (
              <IconButton
                icon="play"
                label="Run"
                variant="primary"
                size={14}
                className="mdbc-canvas-run"
                onClick={() => void runQueryComponent(tabId, id)}
              />
            )}
          </div>
        </div>
        <div ref={hostRef} className="nodrag nowheel mdbc-canvas-sql" />
        <div className="mdbc-canvas-query-status">
          {run?.error ? (
            <span className="mdbc-canvas-result-error">{run.error}</span>
          ) : run?.result ? (
            <span className="mdbc-canvas-result-empty">
              {run.running
                ? runStreamingSummary(run.result)
                : runResultSummary(run.result, run.totalRows, run.complete)}
            </span>
          ) : run?.running ? (
            <span className="mdbc-canvas-result-empty">Running…</span>
          ) : (
            <span className="mdbc-canvas-result-empty">Run the query to preview data</span>
          )}
        </div>
      </div>
    </>
  );
}

const QueryNode = memo(QueryNodeImpl);

export { QueryNode };
