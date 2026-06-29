import { Icon } from "@shared/ui/Icon";
import { Tooltip } from "@shared/ui";
import { PaneContextMenuSurface } from "@shared/ui/ContextMenu";
import {
  RIGHT_RAIL_ACTIONS,
  STATUS_BAR_ICONS,
} from "./constants";
import { useStatusBar } from "./hooks";
import { statusBarContextMenuItems } from "./utils";
import "./index.css";

export function StatusBar() {
  const {
    agentPanelOpen,
    bgLabel,
    canChart,
    canvasActive,
    canvasAgentOpen,
    canvasPropsOpen,
    chartEditorOpen,
    connectionsOpen,
    key,
    leftRailItems,
    leftVisible,
    onClickAgentPanel,
    onClickCanvasAgent,
    onClickCanvasProps,
    onClickChartEditor,
    onClickConnections,
    onClickLeftRail,
    onClickPinnedQueries,
    pinnedQueriesOpen,
    rightVisible,
    tab,
  } = useStatusBar();

  return (
    <PaneContextMenuSurface
      className="mdbc-status"
      context={null}
      getItems={statusBarContextMenuItems}
    >
      <span
        className="mdbc-status-rail"
        role="tablist"
        aria-label="Left sidebar sections"
      >
        {leftRailItems.map((item) => (
          <Tooltip key={item.key} label={item.label} shortcut={key(item.action)}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === item.key && leftVisible}
              aria-label={item.label}
              onClick={() => onClickLeftRail(item.key)}
              className={`mdbc-status-btn${tab === item.key && leftVisible ? " on" : ""}`}
              data-testid={`status-rail-${item.key}`}
            >
              <Icon name={item.icon} size={14} />
            </button>
          </Tooltip>
        ))}
        {canvasActive && (
          <Tooltip label="Canvas Agent">
            <button
              type="button"
              role="tab"
              aria-selected={canvasAgentOpen && leftVisible}
              aria-label="Canvas Agent"
              onClick={onClickCanvasAgent}
              className={`mdbc-status-btn${canvasAgentOpen && leftVisible ? " on" : ""}`}
              data-testid="status-rail-canvas-agent"
            >
              <Icon name={STATUS_BAR_ICONS.canvasAgent} size={14} />
            </button>
          </Tooltip>
        )}
      </span>
      {bgLabel && (
        <span className="mdbc-status-activity" data-testid="status-activity">
          <Icon name={STATUS_BAR_ICONS.activity} size={12} className="mdbc-spin" />
          <span>{bgLabel}</span>
        </span>
      )}
      <span className="mdbc-status-rail mdbc-status-rail-right">
        {canvasActive && (
          <Tooltip label="Canvas Properties">
            <button
              type="button"
              role="tab"
              aria-selected={canvasPropsOpen && rightVisible}
              aria-label="Canvas Properties"
              onClick={onClickCanvasProps}
              className={`mdbc-status-btn${canvasPropsOpen && rightVisible ? " on" : ""}`}
              data-testid="status-rail-canvas-props"
            >
              <Icon name={STATUS_BAR_ICONS.canvasProps} size={14} />
            </button>
          </Tooltip>
        )}
        <Tooltip label="Chart Editor" shortcut={key(RIGHT_RAIL_ACTIONS.chartEditor)}>
          <button
            type="button"
            role="tab"
            aria-selected={chartEditorOpen}
            aria-label="Chart Editor"
            onClick={onClickChartEditor}
            disabled={!canChart}
            className={`mdbc-status-btn${chartEditorOpen ? " on" : ""}`}
            data-testid="status-rail-chart-editor"
          >
            <Icon name={STATUS_BAR_ICONS.chartEditor} size={14} />
          </button>
        </Tooltip>
        <Tooltip label="Agent" shortcut={key(RIGHT_RAIL_ACTIONS.agentPanel)}>
          <button
            type="button"
            role="tab"
            aria-selected={agentPanelOpen}
            aria-label="Agent"
            onClick={onClickAgentPanel}
            className={`mdbc-status-btn${agentPanelOpen ? " on" : ""}`}
            data-testid="status-rail-agent"
          >
            <Icon name={STATUS_BAR_ICONS.agentPanel} size={14} />
          </button>
        </Tooltip>
        <Tooltip label="Pinned Queries" shortcut={key(RIGHT_RAIL_ACTIONS.pinnedQueries)}>
          <button
            type="button"
            role="tab"
            aria-selected={pinnedQueriesOpen}
            aria-label="Pinned Queries"
            onClick={onClickPinnedQueries}
            className={`mdbc-status-btn${pinnedQueriesOpen ? " on" : ""}`}
            data-testid="status-rail-pinned-queries"
          >
            <Icon name={STATUS_BAR_ICONS.pinnedQueries} size={14} />
          </button>
        </Tooltip>
        <Tooltip label="Connections" shortcut={key(RIGHT_RAIL_ACTIONS.connections)}>
          <button
            type="button"
            role="tab"
            aria-selected={connectionsOpen}
            aria-label="Connections"
            onClick={onClickConnections}
            className={`mdbc-status-btn${connectionsOpen ? " on" : ""}`}
            data-testid="status-rail-connections"
          >
            <Icon name={STATUS_BAR_ICONS.connections} size={14} />
          </button>
        </Tooltip>
      </span>
    </PaneContextMenuSurface>
  );
}
