import { registerPane } from "@shared";
import { registerTabView } from "@shared";
import type { EditorTab } from "@shell/types";

import { CanvasView } from "./components/CanvasView";
import { CanvasSection } from "./components/CanvasSection";

/// Register the canvas thinkboard tab view so a tab with `tabType: "canvas"`
/// renders the board. Called once at app startup from the shell.
function registerCanvasTabView(): void {
  registerTabView<EditorTab>({ tabType: "canvas", Component: CanvasView });
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
