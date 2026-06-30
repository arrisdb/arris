import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from "../../constants";
import type { SectionProps } from "../../types";

/// Shape-specific controls: fill and stroke colour, stroke width, and (for a
/// rectangle) corner radius. Colours write into the object's `style`, which the
/// ShapeNode renderer already consumes.
function ShapeSection({ component, onChange }: SectionProps) {
  if (component.kind !== "shape") return null;
  const style = component.style ?? {};
  const isLine = component.shape === "line";

  return (
    <div className="mdbc-pane-form">
      {!isLine && (
        <label className="mdbc-canvas-prop">
          <span className="mdbc-pane-label">Fill</span>
          <input
            type="color"
            className="mdbc-canvas-color"
            value={style.fill ?? DEFAULT_SHAPE_FILL}
            onChange={(e) => onChange({ style: { ...style, fill: e.target.value } })}
          />
        </label>
      )}
      <label className="mdbc-canvas-prop">
        <span className="mdbc-pane-label">Stroke</span>
        <input
          type="color"
          className="mdbc-canvas-color"
          value={style.stroke ?? DEFAULT_SHAPE_STROKE}
          onChange={(e) => onChange({ style: { ...style, stroke: e.target.value } })}
        />
      </label>
      <label className="mdbc-canvas-prop">
        <span className="mdbc-pane-label">Stroke width</span>
        <input
          type="number"
          className="mdbc-pane-input"
          value={style.strokeWidth ?? 1}
          onChange={(e) =>
            onChange({ style: { ...style, strokeWidth: Math.max(0, Number(e.target.value)) } })
          }
        />
      </label>
      {component.shape === "rect" && (
        <label className="mdbc-canvas-prop">
          <span className="mdbc-pane-label">Corner radius</span>
          <input
            type="number"
            className="mdbc-pane-input"
            value={component.radius ?? 0}
            onChange={(e) => onChange({ radius: Math.max(0, Number(e.target.value)) })}
          />
        </label>
      )}
    </div>
  );
}

export { ShapeSection };
