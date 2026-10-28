import { registerPane } from "@shared";
import { registerTabView } from "@shared";
import { listenAppEventIPC } from "@shell/ipc";
import type { EditorTab } from "@shell/types";

import { createElement, lazy } from "react";
import { CanvasSection } from "./components/CanvasSection";
import { CANVAS_CELL_INGESTED_EVENT } from "./constants";
import { createAndOpenCanvas, useCanvasStore } from "./hooks";
import type { CellIngestedEvent } from "./types";

// reactflow is heavy; keep it out of the startup bundle.
const CanvasView = lazy(() =>
  import("./components/CanvasView").then((m) => ({ default: m.CanvasView })),
);

/// A desktop canvas tab: its id is the stored canvas id.
function CanvasTabView({ activeTab }: { activeTab: EditorTab }) {
  return createElement(CanvasView, { canvasId: activeTab.id, tab: activeTab });
}

/// Register the canvas thinkboard tab view so a tab with `tabType: "canvas"`
/// renders the board. Called once at app startup from the shell.
function registerCanvasTabView(): void {
  registerTabView<EditorTab>({ tabType: "canvas", Component: CanvasTabView });
  // Domain-scoped (not per-view): background-ingest totals must land even when
  // no canvas view is mounted, or the run would spin forever.
  listenAppEventIPC<CellIngestedEvent>(CANVAS_CELL_INGESTED_EVENT, (p) => {
    useCanvasStore
      .getState()
      .applyIngestDone(p.boardId, p.cellId, p.totalRows, p.complete);
  }).catch(() => {});
}

/// Register the left-rail section that lists persisted canvas boards, stacked
/// alongside the consoles and notebooks sections.
function registerCanvasSection(): void {
  registerPane({
    id: "canvas",
    side: "left",
    kind: "section",
    priority: 5,
    useActive: () => true,
    Component: CanvasSection,
  });
}

export { CanvasListView } from "./components/CanvasListView";
export { SendToCanvasMenu } from "./components/SendToCanvasMenu";
export {
  CanvasView,
  CanvasSection,
  createAndOpenCanvas,
  registerCanvasTabView,
  registerCanvasSection,
};
