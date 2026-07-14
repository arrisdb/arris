import { Icon } from "@shared/ui/Icon";
import type { IconName } from "@shared/ui/Icon";

import { TOGGLE_ICON_SIZE, TOGGLE_ICON_STROKE } from "../../constants";

interface SegmentedOption<T extends string> {
  id: T;
  icon: IconName;
  title: string;
}

interface SegmentedIconRowProps<T extends string> {
  label: string;
  options: SegmentedOption<T>[];
  isActive: (id: T) => boolean;
  onSelect: (id: T) => void;
}

/// A labelled row of compact icon toggles (the pane's Style and Align controls).
/// `isActive`/`onSelect` carry the per-row semantics so one row serves both a
/// multi-toggle group and a single-choice group.
function SegmentedIconRow<T extends string>({
  label,
  options,
  isActive,
  onSelect,
}: SegmentedIconRowProps<T>) {
  return (
    <div className="mdbc-canvas-prop-row">
      <span className="mdbc-pane-label">{label}</span>
      <div className="mdbc-segmented mdbc-segmented-compact mdbc-segmented-icon">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={isActive(o.id) ? "active" : ""}
            title={o.title}
            aria-label={o.title}
            aria-pressed={isActive(o.id)}
            onClick={() => onSelect(o.id)}
          >
            <Icon name={o.icon} size={TOGGLE_ICON_SIZE} strokeWidth={TOGGLE_ICON_STROKE} />
          </button>
        ))}
      </div>
    </div>
  );
}

export { SegmentedIconRow };
export type { SegmentedOption };
