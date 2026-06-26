import { Icon } from "@shared/ui/Icon";
import { DatabaseKindIcon } from "@domains/connection";
import { Select } from "@shared/ui";
import {
  ContextMenu,
  PaneContextMenuSurface,
} from "@shared/ui/ContextMenu";
import { AlertDialog } from "./components/AlertDialog";
import { useDbtProjectPane } from "./hooks";
import { CliErrorDisplay } from "./components/CliErrorDisplay";
import { DbtRunBar } from "./components/DbtRunBar";
import { FilterRow } from "./components/FilterRow";
import { NodeKindSection } from "./components/NodeKindSection";
import { StatusCard } from "./components/StatusCard";
import { dbtPaneContextMenuItems, dbtTreeSections, shortenHomePath } from "./utils";
import "./index.css";

function DbtProjectPane() {
  const pane = useDbtProjectPane();

  if (!pane.projectReady) return null;

  return (
    <PaneContextMenuSurface
      data-testid="dbt-project-pane"
      context={null}
      getItems={dbtPaneContextMenuItems}
    >
      {pane.isLoading && (
        <div className="mdbc-empty" data-testid="dbt-loading">
          Scanning dbt project…
        </div>
      )}

      <StatusCard
        tool="dbt"
        cliVersion={pane.cliVersion}
        cliError={pane.cliError}
        selectedProfile={pane.selectedProfile}
        selectedTarget={pane.selectedTarget}
        expanded={pane.settingsExpanded}
        onToggle={pane.onToggleSettings}
        onRefresh={pane.onRetry}
      >
        {pane.projectOptions.length > 1 && (
          <>
            <label className="mdbc-pane-label">Project</label>
            <Select
              value={pane.dbtRootPath ?? ""}
              options={pane.projectOptions}
              onChange={(value) => pane.onSelectProject(value)}
              data-testid="dbt-project-select"
            />
          </>
        )}

        {pane.profiles.length > 0 && (
          <>
            <label className="mdbc-pane-label">Profile</label>
            <Select
              value={pane.selectedProfile ?? ""}
              options={pane.profiles.map((profile) => ({ value: profile.name, label: profile.name }))}
              onChange={(value) => pane.selectProfile(value || null)}
              data-testid="dbt-profile-select"
            />
          </>
        )}

        {pane.targets.length > 0 && (
          <>
            <label className="mdbc-pane-label">Target</label>
            <Select
              value={pane.selectedTarget ?? ""}
              options={pane.targets.map((target) => ({ value: target, label: target }))}
              onChange={(value) => pane.selectTarget(value || null)}
              data-testid="dbt-target-select"
            />
          </>
        )}

        <label className="mdbc-pane-label">dbt binary</label>
        <div className="mdbc-dbt-project-actions">
          <input
            type="text"
            className="mdbc-pane-input mdbc-dbt-project-fill"
            value={pane.dbtBinaryPath}
            onChange={(event) => pane.onBinaryPathChange(event.target.value)}
            placeholder="dbt"
            data-testid="dbt-binary-input"
          />
          <button
            className="mdbc-btn-icon"
            onClick={pane.onBrowseBinary}
            title="Browse…"
            data-testid="dbt-binary-browse"
          >
            <Icon name="folder" size={14} />
          </button>
        </div>

        {pane.dbtRootPath && (
          <div className="mdbc-config-links" data-testid="dbt-file-shortcuts">
            <div className="mdbc-config-link-group">
              <button
                className="mdbc-config-link"
                onClick={() => pane.onOpenFile(`${pane.dbtRootPath}/profiles.yml`)}
                data-testid="dbt-open-profiles"
              >
                <Icon name="fileText" size={11} />
                profiles.yml
              </button>
              <span className="mdbc-config-link-path">{shortenHomePath(`${pane.dbtRootPath}/profiles.yml`)}</span>
            </div>
            <div className="mdbc-config-link-group">
              <button
                className="mdbc-config-link"
                onClick={() => pane.onOpenFile(`${pane.dbtRootPath}/dbt_project.yml`)}
                data-testid="dbt-open-project"
              >
                <Icon name="fileText" size={11} />
                dbt_project.yml
              </button>
              <span className="mdbc-config-link-path">{shortenHomePath(`${pane.dbtRootPath}/dbt_project.yml`)}</span>
            </div>
          </div>
        )}

        {pane.cliError && (
          <CliErrorDisplay
            error={pane.cliError}
            expanded={pane.errorExpanded}
            onToggle={pane.onErrorToggle}
          />
        )}
      </StatusCard>

      {pane.loadError && !pane.isLoading && (
        <div className="mdbc-pane-error" data-testid="dbt-load-error">
          {pane.loadError}
        </div>
      )}

      <div className="mdbc-connection-bar" data-testid="dbt-connection-bar">
        <label className="mdbc-pane-label">Connection</label>
        <Select
          value={pane.pickedConnectionId ?? ""}
          options={pane.connections.map((connection) => ({
            value: connection.id,
            label: connection.name,
            icon: <DatabaseKindIcon kind={connection.kind} size={14} />,
          }))}
          onChange={(value) => pane.pickConnection(value || null)}
          placeholder={pane.connections.length > 0 ? "Select a connection…" : "No connections configured"}
          disabled={pane.connections.length === 0}
          data-testid="dbt-connection-select"
        />
      </div>

      <DbtRunBar
        key={pane.runInitialSelect}
        initialSelect={pane.runInitialSelect}
        runningType={pane.runningType}
        onRun={pane.onRunCommand}
      />

      <FilterRow
        value={pane.filterText}
        onChange={pane.onFilterChange}
      />

      <div
        className="mdbc-file-tree"
        onContextMenu={pane.onContextMenuTree}
      >
        {dbtTreeSections(pane.grouped).map(({ key, label, items }) => {
          if (items.length === 0) return null;
          return (
            <NodeKindSection
              key={`${key}-${label}`}
              kind={key}
              label={label}
              items={items}
              selectedId={pane.selectedNodeId}
              runSelectionIds={pane.runSelectionIds}
              onSelect={pane.onSelectNode}
              onToggleRunSelection={pane.onToggleRunSelection}
              onAlert={pane.onNodeAlert}
              onContextMenu={pane.ctxMenu.open}
            />
          );
        })}
      </div>

      {pane.ctxMenu.state && (
        <ContextMenu
          x={pane.ctxMenu.state.x}
          y={pane.ctxMenu.state.y}
          items={pane.contextMenuItems}
          onClose={pane.ctxMenu.close}
          data-testid="dbt-project-ctx-menu"
        />
      )}

      {pane.alertMessage && (
        <AlertDialog
          message={pane.alertMessage}
          onClose={pane.onAlertClose}
        />
      )}

    </PaneContextMenuSurface>
  );
}

export { DbtProjectPane };
