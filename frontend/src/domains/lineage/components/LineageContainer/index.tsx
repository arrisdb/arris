import { Icon } from "@shared/ui/Icon";
import { LineageView } from "../LineageView";
import { useLineageContainer } from "./hooks";
import "./index.css";

function LineageContainer({ onClose }: { onClose: () => void }) {
  const {
    depthOptions,
    direction,
    onToggleDirection,
    edges,
    nodes,
    onSelectNode,
    selectedColumn,
    onSelectColumn,
  } = useLineageContainer();

  if (nodes.length === 0) {
    return (
      <div className="mdbc-lineage-empty">
        Open a dbt or SQLMesh project to see the lineage DAG.
      </div>
    );
  }

  return (
    <div className="mdbc-lineage-root">
      <div className="mdbc-lineage-toolbar">
        <span>Depth</span>
        {depthOptions.map((option) => (
          <button
            key={option.value}
            className={`mdbc-btn text-only${option.active ? " active" : ""} mdbc-lineage-toolbar-button`}
            onClick={option.onClick}
          >
            {option.value}
          </button>
        ))}
        <span className="mdbc-lineage-toolbar-sep" />
        <button
          className="mdbc-btn text-only mdbc-lineage-toolbar-button"
          onClick={onToggleDirection}
        >
          {direction === "vertical" ? "↔ Horizontal" : "↕ Vertical"}
        </button>
        <div className="mdbc-flex-spacer" />
        <button
          onClick={onClose}
          title="Close"
          className="mdbc-icon-btn xs"
          data-testid="lineage-close-button"
        >
          <Icon name="x" size={12} />
        </button>
      </div>
      <div className="mdbc-lineage-canvas-wrap">
        <LineageView
          nodes={nodes}
          edges={edges}
          direction={direction}
          onSelect={onSelectNode}
          onSelectColumn={onSelectColumn}
          selectedColumn={selectedColumn}
        />
      </div>
    </div>
  );
}

export {
  LineageContainer,
};
