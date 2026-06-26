import type { CliErrorDisplayProps } from "../../types";
import { cliErrorPreview } from "../../utils";

function CliErrorDisplay({
  error,
  expanded,
  onToggle,
}: CliErrorDisplayProps) {
  const preview = cliErrorPreview(error, expanded);

  return (
    <div className="mdbc-pane-error" data-testid="dbt-cli-error">
      <div className="mdbc-dbt-project-code-text">{preview.display}</div>
      {preview.needsTruncation && (
        <button
          onClick={onToggle}
          className="mdbc-link mdbc-dbt-project-small-link"
          data-testid="dbt-cli-error-toggle"
        >
          {expanded ? "Show less" : "Show full error"}
        </button>
      )}
    </div>
  );
}

export { CliErrorDisplay };
