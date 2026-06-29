import { useTabsStore } from "@shell/hooks/tabsStore";

import { useCanvasStore } from "../../hooks";
import { CanvasPropertiesPane } from "../CanvasView/components/CanvasPropertiesPane";

/// Shell right-rail host for the canvas object inspector. Reads the active canvas
/// tab and that board's selected object from the store (selection is mirrored
/// there from the board's live ReactFlow selection), then renders the properties
/// pane. With nothing selected it shows a hint so the toggled-open pane is never
/// blank.
function CanvasInspectorRail() {
  const tabId = useTabsStore((s) => {
    const active = s.tabs.find((t) => t.id === s.activeId);
    return active && active.tabType === "canvas" ? active.id : null;
  });
  const updateComponent = useCanvasStore((s) => s.updateComponent);
  const component = useCanvasStore((s) => {
    if (!tabId) return undefined;
    const id = s.selectedByTab[tabId];
    if (!id) return undefined;
    return s.boards[tabId]?.doc.components.find((c) => c.id === id);
  });

  if (!tabId) return null;

  if (!component) {
    return (
      <div className="mdbc-canvas-props" data-testid="canvas-properties-pane">
        <div className="mdbc-pane-header">
          <span className="mdbc-pane-title">Properties</span>
        </div>
        <div className="mdbc-pane-body mdbc-canvas-props-empty">
          Select an object on the board to edit its properties.
        </div>
      </div>
    );
  }

  return (
    <CanvasPropertiesPane
      tabId={tabId}
      component={component}
      onChange={(patch) => updateComponent(tabId, component.id, patch)}
    />
  );
}

export { CanvasInspectorRail };
