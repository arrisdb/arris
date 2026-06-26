import { Icon } from "@shared/ui/Icon";
import type { DbtDocsPreviewProps } from "./types";
import "./index.css";

function DbtDocsPreview({ docs, modelId, isLoading, isStale, hasError, onRefresh, onCollapse }: DbtDocsPreviewProps) {
  const model = docs?.models.find((m) => m.uniqueId === modelId) ?? null;

  return (
    <div className="mdbc-docs-preview">
      <div className="mdbc-docs-toolbar">
        <span className="mdbc-docs-title">Docs</span>

        <div className="mdbc-flex-spacer" />

        {isStale && !isLoading && (
          <span data-testid="docs-stale-chip" className="mdbc-state-chip warning">
            Stale
          </span>
        )}

        {isLoading && (
          <span data-testid="docs-loading-chip" className="mdbc-state-chip accent">
            <Icon name="refreshCw" size={10} />
            Generating
          </span>
        )}

        <button
          onClick={onRefresh}
          title="Regenerate docs"
          className="mdbc-icon-btn xs"
          data-testid="docs-refresh-button"
        >
          <Icon name="refreshCw" size={12} />
        </button>

        <button
          onClick={onCollapse}
          title="Close"
          className="mdbc-icon-btn xs"
          data-testid="docs-collapse-button"
        >
          <Icon name="x" size={12} />
        </button>
      </div>

      <div className="mdbc-docs-body">
        {docs && !docs.schemaVersionSupported && (
          <div className="mdbc-docs-warning" data-testid="docs-schema-warning">
            Generated with an untested dbt manifest schema
            {docs.schemaVersion ? ` (${docs.schemaVersion})` : ""}. Some fields may be missing.
          </div>
        )}

        {isLoading ? (
          <div className="mdbc-results-loading-placeholder" aria-label="Generating docs" data-testid="docs-loading-spinner">
            <Icon name="database" size={34} className="mdbc-results-loading-logo mdbc-spin" />
          </div>
        ) : !docs ? (
          hasError ? (
            <div className="mdbc-placeholder quiet italic" data-testid="docs-error">
              Docs generation failed. Check the error message in the command logs below.
            </div>
          ) : (
            <div className="mdbc-placeholder quiet italic">
              Click Docs to generate documentation.
            </div>
          )
        ) : !model ? (
          <div className="mdbc-placeholder quiet italic" data-testid="docs-no-model">
            No documentation for this model.
          </div>
        ) : (
          <div className="mdbc-docs-content" data-testid="docs-content">
            <div className="mdbc-docs-model-head">
              <span className="mdbc-docs-model-name">{model.name}</span>
              {model.materialized && (
                <span className="mdbc-docs-badge">{model.materialized}</span>
              )}
              <span className="mdbc-docs-badge subtle">{model.resourceType}</span>
            </div>

            {(model.database || model.schema) && (
              <div className="mdbc-docs-relation mono quiet">
                {[model.database, model.schema].filter(Boolean).join(".")}
              </div>
            )}

            {model.description && (
              <p className="mdbc-docs-description">{model.description}</p>
            )}

            <div className="mdbc-docs-section-title">Columns</div>
            {model.columns.length === 0 ? (
              <div className="mdbc-placeholder quiet italic">No columns.</div>
            ) : (
              <table className="mdbc-docs-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Type</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {model.columns.map((c) => (
                    <tr key={c.name}>
                      <td className="mono">{c.name}</td>
                      <td className="mono quiet">{c.type ?? "—"}</td>
                      <td>{c.description ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {model.dependsOn.length > 0 && (
              <>
                <div className="mdbc-docs-section-title">Depends on</div>
                <ul className="mdbc-docs-deps">
                  {model.dependsOn.map((d) => (
                    <li key={d} className="mono">
                      {d.split(".").pop()}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export { DbtDocsPreview };
