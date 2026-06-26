import { Icon } from "@shared/ui/Icon";
import type { StatusCardProps } from "../../types";

function StatusCard({
  cliVersion,
  cliError,
  selectedGateway,
  expanded,
  onToggle,
  onRefresh,
  children,
}: StatusCardProps) {
  const version = cliVersion ? cliVersion.split(" ").pop() : null;

  return (
    <div className="mdbc-status-card" data-testid="sqlmesh-status-card">
      <div className="mdbc-status-card-row" onClick={onToggle} data-testid="sqlmesh-card-toggle">
        <Icon name={expanded ? "chevronDown" : "chevronRight"} size={10} />
        <span className="mdbc-tool-badge sqlmesh">
          sqlmesh
          {version && <span className="version">{version}</span>}
        </span>
        {selectedGateway && (
          <span className="mdbc-status-config">{selectedGateway}</span>
        )}
        {cliError && !cliVersion && (
          <span className="mdbc-status-config mdbc-sqlmesh-project-error">error</span>
        )}
        <span className="mdbc-status-actions">
          <button
            className="mdbc-icon-btn xs"
            onClick={(e) => { e.stopPropagation(); onRefresh(); }}
            title="Reload"
            data-testid="sqlmesh-refresh-btn"
          >
            <Icon name="refreshCw" size={11} />
          </button>
        </span>
      </div>

      {expanded && (
        <div className="mdbc-status-card-body" data-testid="sqlmesh-card-body">
          {children}
        </div>
      )}
    </div>
  );
}

export { StatusCard };
