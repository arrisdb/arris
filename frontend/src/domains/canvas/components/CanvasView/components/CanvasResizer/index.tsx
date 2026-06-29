import { memo } from "react";
import { NodeResizer } from "reactflow";

import { useCanvasStore } from "../../../../hooks";

/// Floor on how small any object can be dragged, so a node can't collapse to an
/// unselectable sliver.
const MIN_W = 60;
const MIN_H = 40;

interface CanvasResizerProps {
  tabId: string;
  id: string;
  /// Show the resize border + corner handles only while the node is selected
  /// (the Figma convention); otherwise the object renders clean.
  visible: boolean;
}

/// Border-drag resize for any canvas object. Sits inside each node renderer and
/// persists the final geometry (position can shift when dragging a top/left
/// edge) back to the store on release. The single place resize is wired, so
/// every object kind resizes identically.
function CanvasResizerImpl({ tabId, id, visible }: CanvasResizerProps) {
  const updateComponent = useCanvasStore((s) => s.updateComponent);
  return (
    <NodeResizer
      nodeId={id}
      isVisible={visible}
      minWidth={MIN_W}
      minHeight={MIN_H}
      lineClassName="mdbc-canvas-resize-line"
      handleClassName="mdbc-canvas-resize-handle"
      onResizeEnd={(_e, p) =>
        updateComponent(tabId, id, { x: p.x, y: p.y, w: p.width, h: p.height })
      }
    />
  );
}

const CanvasResizer = memo(CanvasResizerImpl);

export { CanvasResizer };
