import { memo, useEffect, useMemo, useState } from "react";
import type { NodeProps } from "reactflow";
import type { QueryResult } from "@shared";
import { ChartView } from "@domains/chart";

import { useCanvasStore } from "../../../../hooks";
import { buildChartQuery, sanitizeCellTitle } from "../../../../utils";
import { queryCanvasCacheIPC } from "../../../../ipc";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";

/// The aggregated (or sampled) result the chart renders, fetched from the source
/// cell's FULL cached result over IPC. Independent of the source's 500-row page.
interface ChartData {
  result?: QueryResult;
  loading: boolean;
  error?: string;
}

/// A chart object bound to a query object by `sourceQueryId`. It does NOT render
/// the source's 500-row page: it runs a `GROUP BY` (or a bounded sample) over the
/// source's full cached result in the backend and renders that, so a chart over a
/// million-row query aggregates every row, not just the page. Re-runs whenever the
/// source re-runs or the spec's query-shaping fields change. `nowheel` lets the
/// chart scroll/zoom without panning.
function ChartNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
  const board = useCanvasStore((s) => s.boards[tabId]);
  const component = board?.doc.components.find((c) => c.id === id);
  const source =
    component?.kind === "chart" && component.sourceQueryId
      ? board?.doc.components.find((c) => c.id === component.sourceQueryId)
      : undefined;
  const sourceRun =
    component?.kind === "chart" && component.sourceQueryId
      ? board?.runs[component.sourceQueryId]
      : undefined;
  const sourceTitle =
    source?.kind === "query" && source.title ? sanitizeCellTitle(source.title) : undefined;
  const spec = component?.kind === "chart" ? component.spec : undefined;

  const query = useMemo(
    () => (spec && sourceTitle ? buildChartQuery(spec, sourceTitle) : null),
    [spec, sourceTitle],
  );

  const [agg, setAgg] = useState<ChartData>({ loading: false });
  const sourceResult = sourceRun?.result;

  useEffect(() => {
    // Aggregate only once the source has produced a result to read from.
    if (!query || !sourceResult) {
      setAgg({ loading: false });
      return;
    }
    let cancelled = false;
    setAgg({ loading: true });
    queryCanvasCacheIPC(tabId, query.sql)
      .then((result) => {
        if (!cancelled) setAgg({ loading: false, result });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setAgg({ loading: false, error: String((e as { message?: string })?.message ?? e) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tabId, query, sourceResult]);

  if (!component || component.kind !== "chart") return null;

  // The backend already aggregated, so turn ChartView's client-side aggregation
  // off; a sampled (raw) query keeps the spec as-is for the client mappers.
  const renderSpec = query?.aggregated ? { ...component.spec, aggregation: "none" as const } : component.spec;

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
            spec={renderSpec}
            result={agg.result}
            isRunning={sourceRun?.running || agg.loading}
            error={sourceRun?.error ?? agg.error}
            onEdit={() => {}}
          />
        </div>
      </div>
    </>
  );
}

const ChartNode = memo(ChartNodeImpl);

export { ChartNode };
