import { ResponsiveContainer } from "recharts";
import "./index.css";
import { Icon } from "@shared/ui/Icon";
import { useChartView } from "./hooks";
import type { ChartViewProps } from "./types";

function ChartView(props: ChartViewProps) {
  const { chart, emptyMessage, isKpi, canCustomize, title, onEdit } = useChartView(props);

  if (emptyMessage) {
    return (
      <div className="mdbc-chart-view" ref={props.containerRef}>
        <div className="mdbc-chart-view-body">
          <div className="mdbc-chart-empty" data-testid="chart-view-empty">
            <Icon
              name="barChart"
              size={32}
              color="var(--m-fg-3, #555)"
              className={props.isRunning ? "mdbc-chart-empty-icon spinning" : "mdbc-chart-empty-icon"}
            />
            <span className="mdbc-chart-empty-label">{emptyMessage}</span>
            {canCustomize && (
              <button
                type="button"
                className="mdbc-btn primary"
                onClick={onEdit}
                data-testid="chart-view-edit"
              >
                Edit Chart
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mdbc-chart-view" data-testid="chart-view" ref={props.containerRef}>
      {title && (
        <div className="mdbc-chart-title" data-testid="chart-view-title">
          {title}
        </div>
      )}
      <div className="mdbc-chart-view-body">
        {isKpi ? (
          chart
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {chart ?? <span />}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

export {
  ChartView,
};
