import { NumberStepper } from "@shared/ui";

import {
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_STROKE,
} from "../../constants";
import type { SectionProps } from "../../types";

/// Shape-specific controls: fill and stroke colour, stroke width, and (for a
/// rectangle) corner radius. Colours write into the object's `style`, which the
/// ShapeNode renderer already consumes. Rows match the shared form controls
/// (NumberStepper + the chart-editor colour swatch).
function ShapeSection({ component, onChange }: SectionProps) {
  if (component.kind !== "shape") return null;
  const style = component.style ?? {};
  const isLine = component.shape === "line";

  return (
    <div className="mdbc-pane-form">
      {!isLine && (
        <div className="mdbc-canvas-prop-row">
          <span className="mdbc-pane-label">Fill</span>
          <input
            type="color"
            className="mdbc-canvas-color"
            value={style.fill ?? DEFAULT_SHAPE_FILL}
            onChange={(e) => onChange({ style: { ...style, fill: e.target.value } })}
            aria-label="Fill"
          />
        </div>
      )}
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Stroke</span>
        <input
          type="color"
          className="mdbc-canvas-color"
          value={style.stroke ?? DEFAULT_SHAPE_STROKE}
          onChange={(e) => onChange({ style: { ...style, stroke: e.target.value } })}
          aria-label="Stroke"
        />
      </div>
      <div className="mdbc-canvas-prop-row">
        <span className="mdbc-pane-label">Stroke width</span>
        <NumberStepper
          value={style.strokeWidth ?? 1}
          onChange={(strokeWidth) => onChange({ style: { ...style, strokeWidth } })}
          min={0}
          max={100}
          aria-label="Stroke width"
        />
      </div>
      {component.shape === "rect" && (
        <div className="mdbc-canvas-prop-row">
          <span className="mdbc-pane-label">Corner radius</span>
          <NumberStepper
            value={component.radius ?? 0}
            onChange={(radius) => onChange({ radius })}
            min={0}
            max={500}
            aria-label="Corner radius"
          />
        </div>
      )}
    </div>
  );
}

export { ShapeSection };
