import { Icon } from "@shared/ui/Icon";
import { DatabaseKindIcon } from "@domains/connection";
import { Select } from "@shared/ui";
import {
  ContextMenu,
  PaneContextMenuSurface,
} from "@shared/ui/ContextMenu";
import {
  SQLMESH_MODEL_SECTIONS,
  SQLMESH_PANE_CONTEXT_MENU_ITEMS,
} from "./constants";
import { useSqlMeshProjectPane } from "./hooks";
import { shortenHomePath } from "./utils";
import { CliErrorDisplay } from "./components/CliErrorDisplay";
import { FilterRow } from "./components/FilterRow";
import { ModelKindSection } from "./components/ModelKindSection";
import { SqlMeshRunBar } from "./components/SqlMeshRunBar";
import { StatusCard } from "./components/StatusCard";
import { TestsSection } from "./components/TestsSection";
import "./index.css";

function SqlMeshProjectPane() {
  const pane = useSqlMeshProjectPane();

  if (!pane.projectReady) return null;

  return (
    <PaneContextMenuSurface
      data-testid="sqlmesh-project-pane"
      context={null}
      getItems={SQLMESH_PANE_CONTEXT_MENU_ITEMS}
    >
      {pane.isLoading && (
        <div className="mdbc-empty" data-testid="sqlmesh-loading">
          Scanning SQLMesh project…
        </div>
      )}

      <StatusCard
        cliVersion={pane.cliVersion}
        cliError={pane.cliError}
        selectedGateway={pane.selectedGateway}
        expanded={pane.settingsExpanded}
        onToggle={pane.onToggleSettings}
        onRefresh={pane.onRetry}
      >
        {pane.projectOptions.length > 1 && (
          <>
            <label className="mdbc-pane-label">Project</label>
            <Select
              value={pane.sqlmeshRootPath ?? ""}
              options={pane.projectOptions}
              onChange={(value) => pane.onSelectProject(value)}
              data-testid="sqlmesh-project-select"
            />
          </>
        )}

        {pane.environments.length > 0 && (
          <>
            <label className="mdbc-pane-label">Environment</label>
            <Select
              options={pane.environments.map((environment) => ({
                value: environment.name,
                label: environment.expiry
                  ? `${environment.name} (expires ${environment.expiry})`
                  : environment.name,
              }))}
              value={pane.selectedEnvironment ?? ""}
              onChange={(value) => pane.selectEnvironment(value || null)}
              data-testid="sqlmesh-environment-select"
            />
            <button
              className="mdbc-btn primary"
              onClick={pane.onPromote}
              disabled={pane.promoting}
              data-testid="sqlmesh-promote-btn"
            >
              {pane.promoting ? "Promoting…" : "Promote to prod"}
            </button>
            {pane.promoteStatus && (
              <div className="mdbc-pane-hint" data-testid="sqlmesh-promote-status">
                {pane.promoteStatus}
              </div>
            )}
          </>
        )}

        {pane.gateways.length > 0 && (
          <>
            <label className="mdbc-pane-label">Gateway</label>
            <Select
              options={pane.gateways.map((gateway) => ({
                value: gateway.name,
                label: `${gateway.name} (${gateway.connectionType})`,
              }))}
              value={pane.selectedGateway ?? ""}
              onChange={(value) => pane.selectGateway(value || null)}
              data-testid="sqlmesh-gateway-select"
            />
          </>
        )}

        <label className="mdbc-pane-label">sqlmesh binary</label>
        <div className="mdbc-sqlmesh-project-actions">
          <input
            type="text"
            className="mdbc-pane-input mdbc-sqlmesh-project-fill"
            value={pane.sqlmeshBinaryPath}
            onChange={(event) => pane.onBinaryPathChange(event.target.value)}
            placeholder="sqlmesh"
            data-testid="sqlmesh-binary-input"
          />
          <button
            className="mdbc-btn-icon"
            onClick={pane.onBrowseBinary}
            title="Browse…"
            data-testid="sqlmesh-binary-browse"
          >
            <Icon name="folder" size={14} />
          </button>
        </div>

        {pane.sqlmeshRootPath && (
          <div className="mdbc-config-links" data-testid="sqlmesh-file-shortcuts">
            <div className="mdbc-config-link-group">
              <button
                className="mdbc-config-link"
                onClick={() => pane.onOpenFile(`${pane.sqlmeshRootPath}/config.yaml`)}
                data-testid="sqlmesh-open-config"
              >
                <Icon name="fileText" size={11} />
                config.yaml
              </button>
              <span className="mdbc-config-link-path">{shortenHomePath(`${pane.sqlmeshRootPath}/config.yaml`)}</span>
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
        <div className="mdbc-pane-error" data-testid="sqlmesh-load-error">
          {pane.loadError}
        </div>
      )}

      {pane.connections.length > 0 && (
        <div className="mdbc-connection-bar" data-testid="sqlmesh-connection-bar">
          <label className="mdbc-pane-label">Connection</label>
          <Select
            value={pane.pickedConnectionId ?? ""}
            options={pane.connections.map((connection) => ({
              value: connection.id,
              label: connection.name,
              icon: <DatabaseKindIcon kind={connection.kind} size={14} />,
            }))}
            onChange={(value) => pane.pickConnection(value || null)}
            placeholder="Select a connection…"
            data-testid="sqlmesh-connection-select"
          />
        </div>
      )}

      <SqlMeshRunBar
        runningType={pane.runningCommandType}
        onRun={pane.onRunProject}
      />

      <FilterRow
        value={pane.filterText}
        onChange={pane.onFilterChange}
      />

      <div
        className="mdbc-file-tree"
        onContextMenu={pane.onContextMenuTree}
      >
        {SQLMESH_MODEL_SECTIONS.map(({ key, label }) => {
          const items = pane.grouped[key] ?? [];
          if (items.length === 0) return null;
          return (
            <ModelKindSection
              key={key}
              kind={key}
              label={label}
              items={items}
              selectedName={pane.selectedModel}
              onSelect={pane.onSelectModel}
              onDoubleClick={(model) => pane.onOpenFile(model.filePath)}
              onContextMenu={pane.ctxMenu.open}
            />
          );
        })}
        <TestsSection
          tests={pane.tests}
          onOpen={(test) => pane.onOpenFile(test.filePath, test.name)}
        />
      </div>

      {pane.ctxMenu.state && (
        <ContextMenu
          x={pane.ctxMenu.state.x}
          y={pane.ctxMenu.state.y}
          items={pane.contextMenuItems}
          onClose={pane.ctxMenu.close}
          data-testid="sqlmesh-project-ctx-menu"
        />
      )}
    </PaneContextMenuSurface>
  );
}

export { SqlMeshProjectPane };
