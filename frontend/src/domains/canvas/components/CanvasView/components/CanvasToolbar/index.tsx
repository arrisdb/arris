import type { CanvasToolbarProps } from "../../types";

/// Floating toolbar for adding objects by hand. The agent chat adds objects too;
/// this covers manual text/shape annotations.
function CanvasToolbar({ onAddText, onAddShape }: CanvasToolbarProps) {
  return (
    <div className="mdbc-canvas-toolbar">
      <button type="button" className="mdbc-btn ghost" onClick={onAddText}>
        Text
      </button>
      <button type="button" className="mdbc-btn ghost" onClick={onAddShape}>
        Shape
      </button>
    </div>
  );
}

export { CanvasToolbar };
