import type { SectionProps } from "../../types";

/// Geometry + lock controls shared by every object kind: position (X/Y), size
/// (W/H), and a lock toggle. Edits write straight through to the object, so the
/// node moves/resizes on the board as the numbers change.
function CommonSection({ component, onChange }: SectionProps) {
  return (
    <div className="mdbc-pane-form">
      <div className="mdbc-canvas-prop-grid">
        <label className="mdbc-canvas-prop">
          <span className="mdbc-pane-label">X</span>
          <input
            type="number"
            className="mdbc-pane-input"
            value={Math.round(component.x)}
            onChange={(e) => onChange({ x: Number(e.target.value) })}
          />
        </label>
        <label className="mdbc-canvas-prop">
          <span className="mdbc-pane-label">Y</span>
          <input
            type="number"
            className="mdbc-pane-input"
            value={Math.round(component.y)}
            onChange={(e) => onChange({ y: Number(e.target.value) })}
          />
        </label>
        <label className="mdbc-canvas-prop">
          <span className="mdbc-pane-label">W</span>
          <input
            type="number"
            className="mdbc-pane-input"
            value={Math.round(component.w)}
            onChange={(e) => onChange({ w: Math.max(1, Number(e.target.value)) })}
          />
        </label>
        <label className="mdbc-canvas-prop">
          <span className="mdbc-pane-label">H</span>
          <input
            type="number"
            className="mdbc-pane-input"
            value={Math.round(component.h)}
            onChange={(e) => onChange({ h: Math.max(1, Number(e.target.value)) })}
          />
        </label>
      </div>
      <label className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Locked</span>
        <input
          type="checkbox"
          className="mdbc-checkbox"
          checked={!!component.locked}
          onChange={(e) => onChange({ locked: e.target.checked })}
          aria-label="Locked"
        />
      </label>
    </div>
  );
}

export { CommonSection };
