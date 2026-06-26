import { Icon } from "@shared/ui/Icon";
import { useCompiledPreviewEditor } from "./hooks";
import type { CompiledPreviewProps } from "./types";
import { copyCompiledSql } from "./utils";
import "./index.css";

function CompiledPreview({ compiledSql, isStale, isLoading, hasError, onRefresh, onCollapse }: CompiledPreviewProps) {
  const { hostRef } = useCompiledPreviewEditor(compiledSql);

  return (
    <div className="mdbc-compiled-preview">
      <div className="mdbc-compiled-toolbar">
        <span className="mdbc-compiled-title">Compiled SQL</span>

        <div className="mdbc-flex-spacer" />

        {isStale && !isLoading && (
          <span data-testid="stale-chip" className="mdbc-state-chip warning">
            Stale
          </span>
        )}

        {isLoading && (
          <span data-testid="loading-chip" className="mdbc-state-chip accent">
            <Icon name="refreshCw" size={10} />
            Compiling
          </span>
        )}

        <button
          onClick={onRefresh}
          title="Recompile"
          className="mdbc-icon-btn xs"
        >
          <Icon name="refreshCw" size={12} />
        </button>

        <button
          onClick={() => copyCompiledSql(compiledSql)}
          title="Copy SQL"
          className="mdbc-icon-btn xs"
        >
          <Icon name="copy" size={12} />
        </button>

        <button
          onClick={onCollapse}
          title="Close"
          className="mdbc-icon-btn xs"
          data-testid="compiled-collapse-button"
        >
          <Icon name="x" size={12} />
        </button>
      </div>

      <div className="mdbc-compiled-body">
        {/* Whenever SQL exists, keep the editor host mounted — even while a
            recompile is in flight (the toolbar's "Compiling" chip signals that).
            Swapping it out for the spinner unmounts the CodeMirror host, and a
            recompile yielding identical SQL would otherwise leave the mount
            effect un-fired and the pane blank. */}
        {compiledSql ? (
          <div
            ref={hostRef}
            data-testid="compiled-sql-host"
            className="mdbc-compiled-host"
          />
        ) : isLoading ? (
          <div className="mdbc-results-loading-placeholder" aria-label="Compiling" data-testid="compiled-loading-spinner">
            <Icon name="database" size={34} className="mdbc-results-loading-logo mdbc-spin" />
          </div>
        ) : hasError ? (
          <div className="mdbc-placeholder quiet italic" data-testid="compiled-error">
            Compile failed. Check the error message in the command logs below.
          </div>
        ) : (
          <div className="mdbc-placeholder quiet italic">
            Click Compile to preview rendered SQL.
          </div>
        )}
      </div>
    </div>
  );
}

export { CompiledPreview };
