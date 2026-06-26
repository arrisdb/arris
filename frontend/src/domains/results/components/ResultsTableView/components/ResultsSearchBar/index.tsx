import { Icon } from "@shared/ui/Icon";
import { IconButton, Tooltip } from "@shared/ui";
import type { ResultsSearchBarProps } from "../../types";

// In-view find bar: text-matches the visible page only (not the whole dataset).
// Enter / Shift+Enter walk the matches; the counter mirrors the focused match.
function ResultsSearchBar({
  query,
  setQuery,
  matchCount,
  currentIndex,
  onNext,
  onPrevious,
  onClose,
}: ResultsSearchBarProps) {
  return (
    <div className="mdbc-filter-builder" data-testid="results-search-bar">
      <span className="mdbc-runs-label">Find</span>
      <label className="mdbc-filter-input">
        <span className="glyph">
          <Icon name="search" size={12} />
        </span>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) onPrevious();
              else onNext();
            }
            if (event.key === "Escape") onClose();
          }}
          placeholder="Find in visible rows"
          spellCheck={false}
          data-testid="results-search-input"
        />
      </label>
      <span className="mdbc-pagination-label" data-testid="results-search-count">
        {query.trim() ? `${matchCount === 0 ? 0 : currentIndex + 1}/${matchCount}` : "0/0"}
      </span>
      <Tooltip label="Previous match">
        <IconButton
          icon="arrowUp"
          label="Previous match"
          variant="ghost"
          disabled={matchCount === 0}
          onClick={onPrevious}
          data-testid="results-search-prev"
        />
      </Tooltip>
      <Tooltip label="Next match">
        <IconButton
          icon="arrowDown"
          label="Next match"
          variant="ghost"
          disabled={matchCount === 0}
          onClick={onNext}
          data-testid="results-search-next"
        />
      </Tooltip>
      <Tooltip label="Close search">
        <IconButton
          icon="x"
          label="Close search"
          variant="ghost"
          onClick={onClose}
          data-testid="results-search-close"
        />
      </Tooltip>
    </div>
  );
}

export { ResultsSearchBar };
