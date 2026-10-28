import { LineageView } from "./components/LineageView";
import { EMPTY_MESSAGE, LINEAGE_TEST_ID, LOADING_MESSAGE } from "./constants";
import { useLineagePanel } from "./hooks";
import type { LineagePanelProps } from "./types";
import "./index.css";

/// Model lineage graph; double-click opens a model, a column click traces what feeds it.
function LineagePanel({
  tool,
  name,
  selected = null,
  onSelectColumn,
  onOpenModel,
}: LineagePanelProps) {
  const { nodes, edges, error, loading } = useLineagePanel(tool, name, selected);

  return (
    <div className="mdbc-analytics-lineage" data-testid={LINEAGE_TEST_ID}>
      {error && <p className="mdbc-analytics-message">{error}</p>}
      {loading && <p className="mdbc-analytics-message">{LOADING_MESSAGE}</p>}
      {!loading && !error && nodes.length === 0 && (
        <p className="mdbc-analytics-message">{EMPTY_MESSAGE}</p>
      )}
      {nodes.length > 0 && (
        <LineageView
          nodes={nodes}
          edges={edges}
          onSelect={onOpenModel}
          onSelectColumn={onSelectColumn}
          selectedColumn={selected}
        />
      )}
    </div>
  );
}

export { LineagePanel };
