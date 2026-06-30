import { NumberStepper } from "@shared/ui";

import type { SectionProps } from "../../types";

const POS_MIN = -100000;
const POS_MAX = 100000;
const SIZE_MAX = 100000;

/// Geometry + lock controls shared by every object kind: position (X/Y), size
/// (W/H), and a lock toggle. Edits write straight through to the object, so the
/// node moves/resizes on the board as the numbers change. Numbers use the shared
/// NumberStepper and the lock uses the app checkbox, so the pane matches the
/// settings and chart-editor controls.
function CommonSection({ component, onChange }: SectionProps) {
  return (
    <div className="mdbc-pane-form">
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">X</span>
        <NumberStepper
          value={Math.round(component.x)}
          onChange={(x) => onChange({ x })}
          min={POS_MIN}
          max={POS_MAX}
          aria-label="X"
        />
      </div>
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Y</span>
        <NumberStepper
          value={Math.round(component.y)}
          onChange={(y) => onChange({ y })}
          min={POS_MIN}
          max={POS_MAX}
          aria-label="Y"
        />
      </div>
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">W</span>
        <NumberStepper
          value={Math.round(component.w)}
          onChange={(w) => onChange({ w })}
          min={1}
          max={SIZE_MAX}
          aria-label="W"
        />
      </div>
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">H</span>
        <NumberStepper
          value={Math.round(component.h)}
          onChange={(h) => onChange({ h })}
          min={1}
          max={SIZE_MAX}
          aria-label="H"
        />
      </div>
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Locked</span>
        <input
          type="checkbox"
          className="mdbc-checkbox"
          checked={!!component.locked}
          onChange={(e) => onChange({ locked: e.target.checked })}
          aria-label="Locked"
        />
      </div>
    </div>
  );
}

export { CommonSection };
