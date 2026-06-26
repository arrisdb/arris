import { Icon } from "@shared/ui/Icon";
import { IconButton } from "@shared/ui/IconButton";
import { ConnectionIndicator } from "../ConnectionIndicator";
import { ResultsTableView } from "@domains/results";
import type { TableTabViewProps } from "./types";
import { useTableTabAutoRun } from "./hooks";
import { tableLabel } from "./utils";

function TableTabView({
  activeTab,
  tabConnectionId,
  connections,
  runActiveTab,
}: TableTabViewProps) {
  useTableTabAutoRun(activeTab, runActiveTab);

  return (
    <>
      <div className="mdbc-runbar">
        <span className="mdbc-runbar-label">
          <Icon name="table" size={13} />
          {tableLabel(activeTab)}
        </span>
        <div className="mdbc-flex-spacer" />
        <IconButton
          icon="refreshCw"
          loadingIcon="refreshCw"
          loading={activeTab.isRunning}
          label="Refresh table data"
          variant="ghost"
          size={12}
          onClick={runActiveTab}
          disabled={activeTab.isRunning}
          data-testid="table-refresh-button"
        />
        <ConnectionIndicator connectionId={tabConnectionId} connections={connections} isFederation={false} />
      </div>
      <div className="mdbc-table-results">
        <ResultsTableView tabId={activeTab.id} />
      </div>
    </>
  );
}

export { TableTabView };
