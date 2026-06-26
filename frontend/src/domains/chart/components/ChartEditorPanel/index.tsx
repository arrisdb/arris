import "./index.css";
import { PaneContextMenuSurface } from "@shared/ui/ContextMenu";
import { useChartEditorStore } from "../../hooks/store";
import { CHART_EDITOR_CONTEXT_MENU_ITEMS } from "./constants";
import { useChartEditorPanel } from "./hooks";
import { ChartEditorContent } from "./components/ChartEditorContent";

function ChartEditorPanel() {
  const pane = useChartEditorPanel();
  // Re-keying on each open() replays the one-shot shine animation, even when
  // the editor is already open for the same tab. Inputs are store-controlled,
  // so the remount carries no local state.
  const pulse = useChartEditorStore((state) => state.pulse);

  if (!pane) return null;

  return (
    <PaneContextMenuSurface
      key={pulse}
      context={null}
      getItems={CHART_EDITOR_CONTEXT_MENU_ITEMS}
      data-testid="chart-editor-panel"
      className="mdbc-full-pane-stack mdbc-shine"
    >
      <ChartEditorContent pane={pane} />
    </PaneContextMenuSurface>
  );
}

export { ChartEditorPanel };
