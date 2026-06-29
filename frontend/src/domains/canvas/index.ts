import { registerPane } from "@shared";
import { registerTabView } from "@shared";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";

import { CanvasAgentRail } from "./components/CanvasAgentRail";
import { CanvasInspectorRail } from "./components/CanvasInspectorRail";
import { CanvasView } from "./components/CanvasView";
import { CanvasSection } from "./components/CanvasSection";
import { useCanvasStore } from "./hooks";

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

/// True while the active center tab is a canvas board.
function useActiveTabIsCanvas(): boolean {
  return useTabsStore(
    (s) => s.tabs.find((t) => t.id === s.activeId)?.tabType === "canvas",
  );
}

/// The agent chat is the left primary while a canvas board is active and the user
/// has not toggled it off; it outranks the files/git primaries so the board's
/// agent takes the left rail.
function useCanvasAgentActive(): boolean {
  const isCanvas = useActiveTabIsCanvas();
  const open = useCanvasStore((s) => s.agentPaneOpen);
  return isCanvas && open;
}

/// The object inspector is the right primary while a canvas board is active and
/// the user has not toggled it off; it outranks chart/connections so a selected
/// object's properties take the right rail.
function useCanvasInspectorActive(): boolean {
  const isCanvas = useActiveTabIsCanvas();
  const open = useCanvasStore((s) => s.propsPaneOpen);
  return isCanvas && open;
}

/// Register the canvas agent chat (left) and object inspector (right) as shell
/// sidebar primaries. They only resolve while a canvas board is active, so they
/// yield the rails back to the normal panes on any other tab.
function registerCanvasPanes(): void {
  registerPane({
    id: "canvasAgent",
    side: "left",
    kind: "primary",
    priority: 50,
    title: "Agent",
    useActive: useCanvasAgentActive,
    Component: CanvasAgentRail,
  });
  registerPane({
    id: "canvasInspector",
    side: "right",
    kind: "primary",
    priority: 50,
    title: "Properties",
    useActive: useCanvasInspectorActive,
    Component: CanvasInspectorRail,
  });
}

export {
  CanvasView,
  CanvasSection,
  registerCanvasTabView,
  registerCanvasSection,
  registerCanvasPanes,
};
