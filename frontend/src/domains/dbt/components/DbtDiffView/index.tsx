import { formatDiffCell } from "./utils";
import type { DbtDiffViewProps, DiffSampleProps, UpdatedDiffGridProps } from "./types";
import "./index.css";

function DiffSample({ title, emptyHint, sample }: DiffSampleProps) {
  return (
    <section className="mdbc-diff-sample">
      <h4 className="mdbc-diff-sample-title">{title}</h4>
      {sample.rows.length === 0 ? (
        <div className="mdbc-diff-empty">{emptyHint}</div>
      ) : (
        <table className="mdbc-diff-table">
          <thead>
            <tr>
              {sample.columns.map((col) => (
                <th key={col.name}>{col.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sample.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{formatDiffCell(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// One row per updated key. Both samples are key-ordered, so prod row i and new
// row i share the key. Unchanged columns render the value plainly; a changed
// column shows the old value (red, struck through) and the new value (green)
// inline in the same cell, git-style.
function UpdatedDiffGrid({ prod, next }: UpdatedDiffGridProps) {
  if (prod.rows.length === 0) {
    return <div className="mdbc-diff-empty">No rows.</div>;
  }
  const columns = prod.columns;
  return (
    <table className="mdbc-diff-table mdbc-diff-updated-table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.name}>{col.name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {prod.rows.map((oldRow, ri) => {
          const newRow = next.rows[ri] ?? [];
          return (
            <tr key={ri}>
              {columns.map((_, ci) => {
                const oldVal = formatDiffCell(oldRow[ci]);
                const newVal = formatDiffCell(newRow[ci]);
                if (oldVal === newVal) {
                  return <td key={ci}>{newVal}</td>;
                }
                return (
                  <td key={ci} className="mdbc-diff-cell-changed">
                    <span className="mdbc-diff-old">{oldVal}</span>
                    <span className="mdbc-diff-new">{newVal}</span>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// Renders a dbt slim-CI row diff in the bottom results pane: summary counts,
// any schema delta, sample grids for added/removed rows, and (when a primary
// key was supplied) a stacked prod-old/new-changed pair for updated rows.
function DbtDiffView({ result }: DbtDiffViewProps) {
  const schemaDelta = [
    ...result.newOnlyColumns.map((c) => `+${c}`),
    ...result.prodOnlyColumns.map((c) => `−${c}`),
  ];
  const keyed = result.keyColumns.length > 0;

  return (
    <div className="mdbc-diff-view">
      <div className="mdbc-diff-summary">
        <span className="mdbc-diff-chip">prod: {result.prodTotal}</span>
        <span className="mdbc-diff-chip">new: {result.newTotal}</span>
        <span className="mdbc-diff-chip added" data-testid="diff-added-count">
          +{result.addedCount} added
        </span>
        <span className="mdbc-diff-chip removed" data-testid="diff-removed-count">
          −{result.removedCount} removed
        </span>
        {keyed && (
          <span className="mdbc-diff-chip updated" data-testid="diff-updated-count">
            ~{result.updatedCount} updated
          </span>
        )}
        <span className="mdbc-diff-chip mode">{result.mode}</span>
        {keyed && (
          <span className="mdbc-diff-chip key" data-testid="diff-key-columns">
            key: {result.keyColumns.join(", ")}
          </span>
        )}
      </div>
      {schemaDelta.length > 0 && (
        <div className="mdbc-diff-schema" data-testid="diff-schema-delta">
          Schema change: {schemaDelta.join(", ")}
        </div>
      )}
      <DiffSample
        title="Added (in new, not prod)"
        emptyHint="No rows."
        sample={result.addedSample}
      />
      <DiffSample
        title="Removed (in prod, not new)"
        emptyHint="No rows."
        sample={result.removedSample}
      />
      {keyed && (
        <section className="mdbc-diff-updated" data-testid="diff-updated-section">
          <h3 className="mdbc-diff-updated-heading">
            Updated (key matched, values changed) — changed cells show{" "}
            <span className="mdbc-diff-row-old-label">old</span> →{" "}
            <span className="mdbc-diff-row-new-label">new</span>
          </h3>
          <UpdatedDiffGrid prod={result.updatedProdSample} next={result.updatedNewSample} />
        </section>
      )}
    </div>
  );
}

export { DbtDiffView };
