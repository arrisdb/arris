import { CommonSection } from "./components/CommonSection";
import { KIND_LABEL } from "./constants";
import type { CanvasPropertiesPaneProps } from "./types";
import { SECTION_FOR } from "./utils";
import "./index.css";

/// The right-hand properties pane, shown while exactly one object is selected.
/// A common geometry/lock section sits at the top; below it the object's
/// kind-specific section is picked from the registry, so each kind shows its own
/// controls (shape fill/stroke, text font, chart kind, and so on).
function CanvasPropertiesPane({ tabId, component, onChange }: CanvasPropertiesPaneProps) {
  const KindSection = SECTION_FOR[component.kind];

  return (
    <div className="mdbc-canvas-props" data-testid="canvas-properties-pane">
      <div className="mdbc-pane-header">
        <span className="mdbc-pane-title">{KIND_LABEL[component.kind]}</span>
      </div>
      <div className="mdbc-pane-body">
        <CommonSection tabId={tabId} component={component} onChange={onChange} />
        <KindSection tabId={tabId} component={component} onChange={onChange} />
      </div>
    </div>
  );
}

export { CanvasPropertiesPane };
