import { Select } from "@shared/ui";

import type { StickyColor } from "../../../../../../types";
import { STICKY_COLOR_OPTIONS } from "../../constants";
import type { SectionProps } from "../../types";

/// Sticky-note controls: the note tint. The renderer maps the colour to its card
/// background.
function StickySection({ component, onChange }: SectionProps) {
  if (component.kind !== "sticky") return null;

  return (
    <div className="mdbc-pane-form">
      <span className="mdbc-pane-label">Colour</span>
      <Select
        value={component.color ?? "yellow"}
        options={STICKY_COLOR_OPTIONS}
        onChange={(v) => onChange({ color: v as StickyColor })}
        data-testid="sticky-color-select"
      />
    </div>
  );
}

export { StickySection };
