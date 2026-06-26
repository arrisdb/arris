import { Icon } from "@shared/ui/Icon";
import type { ResultsFilterBarProps } from "../../types";

function ResultsFilterBar({
  canRunQuery,
  filterBusy,
  filterDraft,
  filterRaw,
  onClearFilter,
  onCommitFilterDraft,
  setFilterDraft,
  setFilterOpen,
}: ResultsFilterBarProps) {
  return (
    <div className="mdbc-filter-builder" data-testid="results-filter-bar">
      <span className="mdbc-runs-label">Where</span>
      <label className="mdbc-filter-input">
        <span className="glyph">
          <Icon name="filter" size={12} />
        </span>
        <input
          value={filterDraft}
          onChange={(event) => setFilterDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onCommitFilterDraft();
            if (event.key === "Escape") {
              setFilterDraft(filterRaw);
              setFilterOpen(false);
            }
          }}
          placeholder="e.g. id = 123 AND name LIKE '%test%'"
          spellCheck={false}
          data-testid="results-filter-input"
        />
      </label>
      <button
        className="mdbc-btn ghost"
        onClick={onClearFilter}
        disabled={(!filterDraft && !filterRaw) || filterBusy}
        title="Clear filter and re-run original query"
      >
        Clear
      </button>
      <button
        className="mdbc-btn primary"
        onClick={onCommitFilterDraft}
        disabled={filterBusy || !canRunQuery}
        title="Apply WHERE clause and re-run query"
      >
        {filterBusy ? "Running..." : "Apply"}
      </button>
    </div>
  );
}

export { ResultsFilterBar };
