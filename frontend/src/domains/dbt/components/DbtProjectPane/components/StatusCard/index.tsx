import { Icon } from "@shared/ui/Icon";
import type { StatusCardProps } from "../../types";
import { extractDbtVersion } from "../../utils";

function StatusCard({
  tool,
  cliVersion,
  cliError,
  selectedProfile,
  selectedTarget,
  expanded,
  onToggle,
  onRefresh,
  children,
}: StatusCardProps) {
  const version = cliVersion ? extractDbtVersion(cliVersion) : null;
  const configSummary = [selectedProfile, selectedTarget].filter(Boolean).join(" · ");

  return (
    <div className="mdbc-status-card" data-testid={`${tool}-status-card`}>
      <div className="mdbc-status-card-row" onClick={onToggle} data-testid={`${tool}-card-toggle`}>
        <Icon name={expanded ? "chevronDown" : "chevronRight"} size={10} />
        <span className={`mdbc-tool-badge ${tool}`}>
          {tool}
          {version && <span className="version">{version}</span>}
        </span>
        {configSummary && (
          <span className="mdbc-status-config">{configSummary}</span>
        )}
        {cliError && !cliVersion && (
          <span className="mdbc-status-config mdbc-dbt-project-error">error</span>
        )}
        <span className="mdbc-status-actions">
          <button
            className="mdbc-icon-btn xs"
            onClick={(e) => { e.stopPropagation(); onRefresh(); }}
            title="Reload"
            data-testid={`${tool}-refresh-btn`}
          >
            <Icon name="refreshCw" size={11} />
          </button>
        </span>
      </div>

      {expanded && (
        <div className="mdbc-status-card-body" data-testid={`${tool}-card-body`}>
          {children}
        </div>
      )}
    </div>
  );
}

export { StatusCard };
