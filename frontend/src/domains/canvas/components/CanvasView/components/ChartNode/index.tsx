import { memo, useEffect, useMemo, useState } from "react";
import type { NodeProps } from "reactflow";
import type { ChartSpec, QueryResult } from "@shared";
import { ChartView, reconcileChartSpec } from "@domains/chart";

import { useCanvasStore } from "../../../../hooks";
import { buildChartQuery, sanitizeCellTitle } from "../../../../utils";
import { queryCanvasCacheIPC } from "../../../../ipc";
import type { CanvasNodeData } from "../../types";
import { CanvasResizer } from "../CanvasResizer";
import { CHART_FALLBACK_TITLE } from "./constants";

/// The aggregated (or sampled) result the chart renders, fetched from the source
/// cell's FULL cached result over IPC. Independent of the source's 500-row page.
interface ChartData {
  result?: QueryResult;
  loading: boolean;
  error?: string;
}

/// A chart bound to a query by `sourceQueryId`: it aggregates (or samples) the
/// source's FULL cached result in the backend, never just the 500-row page.
function ChartNodeImpl({ id, data, selected }: NodeProps<CanvasNodeData>) {
  const { tabId } = data;
  const board = useCanvasStore((s) => s.boards[tabId]);
  const updateComponent = useCanvasStore((s) => s.updateComponent);
  const component = board?.doc.components.find((c) => c.id === id);
  const chart = component?.kind === "chart" ? component : undefined;
  const source = chart?.sourceQueryId
    ? board?.doc.components.find((c) => c.id === chart.sourceQueryId)
    : undefined;
  const sourceRun = chart?.sourceQueryId ? board?.runs[chart.sourceQueryId] : undefined;
  const sourceTitle =
    source?.kind === "query" && source.title ? sanitizeCellTitle(source.title) : undefined;
  // Human-readable name of the bound query, used as the default cell title.
  const sourceName = source?.kind === "query" ? source.title || source.id : undefined;
  const spec = chart?.spec;
  const maxRows = chart?.maxRows;
  const sourceResult = sourceRun?.result;

  // Drop axis/series columns that the source no longer has (e.g. after the chart
  // was re-pointed to a different query), so a stale column never reaches the SQL
  // as `SUM("missing")`. Empty axes degrade to ChartView's "Customize chart" state
  // instead of a hard schema error.
  const effectiveSpec = useMemo(
    () => (spec && sourceResult ? reconcileChartSpec(spec, sourceResult) : spec),
    [spec, sourceResult],
  );

  const query = useMemo(
    () => (effectiveSpec && sourceTitle ? buildChartQuery(effectiveSpec, sourceTitle, maxRows) : null),
    [effectiveSpec, sourceTitle, maxRows],
  );

  const [agg, setAgg] = useState<ChartData>({ loading: false });

  // Persist the reconciled spec so the properties pane reflects the valid columns.
  useEffect(() => {
    if (!spec || !effectiveSpec) return;
    if (JSON.stringify(effectiveSpec) !== JSON.stringify(spec)) {
      updateComponent(tabId, id, { spec: effectiveSpec as ChartSpec });
    }
  }, [tabId, id, spec, effectiveSpec, updateComponent]);

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
  const drawSpec = effectiveSpec ?? component.spec;
  const renderSpec = query?.aggregated ? { ...drawSpec, aggregation: "none" as const } : drawSpec;

  // Title bar defaults to the bound query's name; the error surfaces in the
  // bottom status bar (red) rather than as the chart body's empty message.
  const title = component.title || sourceName || CHART_FALLBACK_TITLE;
  const error = sourceRun?.error ?? agg.error;

  return (
    <>
      <CanvasResizer tabId={tabId} id={id} visible={selected} />
      <div className={`mdbc-canvas-node mdbc-canvas-chart nowheel${selected ? " selected" : ""}`}>
        <div className="mdbc-canvas-node-head">
          <span className="mdbc-canvas-node-title">{title}</span>
        </div>
        <div className="mdbc-canvas-chart-body">
          <ChartView
            spec={renderSpec}
            result={agg.result}
            isRunning={sourceRun?.running || agg.loading}
            onEdit={() => {}}
          />
        </div>
        {error ? (
          <div className="mdbc-canvas-chart-status" data-testid="chart-node-error">
            {error}
          </div>
        ) : null}
      </div>
    </>
  );
}

const ChartNode = memo(ChartNodeImpl);

export { ChartNode };
