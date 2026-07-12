import { memo, useCallback, useEffect, useState } from "react";
import type { NodeProps } from "reactflow";
import type { QueryResult } from "@shared";

import { useCanvasStore } from "../../../../hooks";
import { sanitizeCellTitle } from "../../../../utils";
import { fetchCanvasCellPageIPC } from "../../../../ipc";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";
import { TABLE_PAGE_ROWS } from "./constants";
import { cellText, pageRangeLabel } from "./utils";

/// A data table bound to a query by `sourceQueryId`: Prev/Next page through the
/// source's FULL cached result from the backend, one page in the webview at a time.
function TableNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
  const board = useCanvasStore((s) => s.boards[tabId]);
  const component = board?.doc.components.find((c) => c.id === id);
  const sourceId = component?.kind === "table" ? component.sourceQueryId : null;
  const source = sourceId ? board?.doc.components.find((c) => c.id === sourceId) : undefined;
  const sourceRun = sourceId ? board?.runs[sourceId] : undefined;
  const sourceTitle =
    source?.kind === "query" && source.title ? sanitizeCellTitle(source.title) : undefined;
  const pageSize = (component?.kind === "table" && component.previewRows) || TABLE_PAGE_ROWS;

  const sourceResult = sourceRun?.result;
  // While the source is still streaming into the cache, the early page is shown
  // but the full row count is unknown and cache pages are not yet readable.
  const streaming = !!sourceRun?.running;
  const total = sourceRun?.totalRows ?? sourceResult?.rows.length ?? 0;
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<QueryResult | undefined>(sourceResult);

  // Reset to the first page whenever the source produces a new result.
  useEffect(() => {
    setOffset(0);
    setPage(sourceResult);
  }, [sourceResult]);

  const goto = useCallback(
    (next: number) => {
      if (!sourceTitle) return;
      fetchCanvasCellPageIPC(tabId, sourceTitle, next, pageSize)
        .then((result) => {
          if (!result) return;
          setOffset(next);
          setPage(result);
        })
        .catch(() => {});
    },
    [tabId, sourceTitle, pageSize],
  );

  if (!component || component.kind !== "table") return null;

  const rows = page?.rows.slice(0, pageSize) ?? [];
  const canPrev = !streaming && offset > 0;
  const canNext = !streaming && offset + pageSize < total;
  const showPager = !!page && (streaming || total > pageSize);

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
          {sourceRun?.error ? (
            <div className="mdbc-canvas-result-error">{sourceRun.error}</div>
          ) : page ? (
            <table className="mdbc-canvas-result-table">
              <thead>
                <tr>
                  {page.columns.map((col) => (
                    <th key={col.name}>{col.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((value, ci) => (
                      <td key={ci}>{cellText(value)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : streaming ? (
            <div className="mdbc-canvas-result-empty">Running…</div>
          ) : (
            <div className="mdbc-canvas-result-empty">
              {sourceId ? "Run the source query to see results" : "Pick a source query"}
            </div>
          )}
        </div>
        {showPager ? (
          <div className="mdbc-canvas-result-pager">
            <span>{pageRangeLabel(offset, rows.length, streaming ? undefined : total)}</span>
            <span>
              <button
                type="button"
                className="mdbc-btn"
                disabled={!canPrev}
                onClick={() => goto(offset - pageSize)}
              >
                Prev
              </button>{" "}
              <button
                type="button"
                className="mdbc-btn"
                disabled={!canNext}
                onClick={() => goto(offset + pageSize)}
              >
                Next
              </button>
            </span>
          </div>
        ) : null}
      </div>
    </>
  );
}

const TableNode = memo(TableNodeImpl);

export { TableNode };
