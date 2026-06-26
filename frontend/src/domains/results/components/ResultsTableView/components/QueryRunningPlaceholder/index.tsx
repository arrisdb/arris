import { Icon } from "@shared/ui/Icon";

function QueryRunningPlaceholder() {
  return (
    <div
      className="mdbc-results-loading-placeholder"
      aria-label="Query running"
      data-testid="results-loading-spinner"
    >
      <Icon name="database" size={34} className="mdbc-results-loading-logo mdbc-spin" />
    </div>
  );
}

export { QueryRunningPlaceholder };
