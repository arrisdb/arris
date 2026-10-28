import { SECTIONS, SECTION_LABELS, TOOL_LABELS } from "../../constants";
import type { AnalyticsNavProps } from "./types";
import "./index.css";

/// Tool title plus the Models / Lineage / Runs switch shared by every tool page.
function AnalyticsNav({ tool, section, onSelect }: AnalyticsNavProps) {
  return (
    <div className="mdbc-pane-header mdbc-analytics-nav">
      <span className="mdbc-pane-title">{TOOL_LABELS[tool]}</span>
      {SECTIONS.map((s) => (
        <button
          key={s}
          type="button"
          className="mdbc-analytics-nav-tab"
          aria-current={s === section ? "page" : undefined}
          onClick={() => onSelect(s)}
        >
          {SECTION_LABELS[s]}
        </button>
      ))}
    </div>
  );
}

export { AnalyticsNav };
