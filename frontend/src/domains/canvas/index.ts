import { registerPane } from "@shared";
import { registerTabView } from "@shared";
import { listenAppEventIPC } from "@shell/ipc";
import type { EditorTab } from "@shell/types";

import { CanvasView } from "./components/CanvasView";
import { CanvasSection } from "./components/CanvasSection";
import { CANVAS_CELL_INGESTED_EVENT } from "./constants";
import { useCanvasStore } from "./hooks";
import type { CellIngestedEvent } from "./types";

/// Register the canvas thinkboard tab view so a tab with `tabType: "canvas"`
/// renders the board. Called once at app startup from the shell.
function registerCanvasTabView(): void {
  registerTabView<EditorTab>({ tabType: "canvas", Component: CanvasView });
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

export { CanvasView, CanvasSection, registerCanvasTabView, registerCanvasSection };
