import { registerTabView } from "@shared";
import type { EditorTab } from "@shell/types";

import { CanvasView } from "./components/CanvasView";

/// Register the canvas thinkboard tab view so a tab with `tabType: "canvas"`
/// renders the board. Called once at app startup from the shell.
function registerCanvasTabView(): void {
  registerTabView<EditorTab>({ tabType: "canvas", Component: CanvasView });
}

export { CanvasView, registerCanvasTabView };
