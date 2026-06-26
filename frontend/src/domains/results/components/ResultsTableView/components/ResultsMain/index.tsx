import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Icon } from "@shared/ui/Icon";
import { FederationProgress } from "../../../FederationProgress";
import type { ResultsMainProps } from "../../types";

function ResultsMain({
  detailArea,
  fedDagVisible,
  filterBusy,
  queryRunning,
  showDag,
  showRowDetailPane,
  tableArea,
}: ResultsMainProps) {
  return (
    <div className="mdbc-results-main">
      {(filterBusy || queryRunning) && !(showDag && fedDagVisible) && (
        <div
          className="mdbc-results-loading-overlay"
          data-testid="results-loading-overlay"
        >
          <Icon name="database" size={34} className="mdbc-results-loading-logo mdbc-spin" />
        </div>
      )}
      {showDag && fedDagVisible ? (
        <div className="mdbc-fed-container" data-testid="federation-progress-container">
          <FederationProgress />
        </div>
      ) : showRowDetailPane ? (
        <PanelGroup
          direction="horizontal"
          autoSaveId="arris-results-detail-split"
          className="mdbc-results-split"
        >
          <Panel defaultSize={70} minSize={20}>
            {tableArea}
          </Panel>
          <PanelResizeHandle className="mdbc-resize-handle-v" />
          <Panel defaultSize={30} minSize={15}>
            {detailArea}
          </Panel>
        </PanelGroup>
      ) : (
        <div className="mdbc-results-body">{tableArea}</div>
      )}
    </div>
  );
}

export { ResultsMain };
