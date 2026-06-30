import { useMemo } from "react";
import { buildChartEditorViewModel, defaultChartSpec } from "@domains/chart";
import type { ChartEditorPanelViewModel } from "@domains/chart";
import type { ChartSpec } from "@shared";

import { useCanvasStore } from "../../../../../../hooks";
import type { ChartComponent } from "../../../../../../types";

/// Adapt a selected chart object to the shared chart-editor view model so the
/// canvas properties pane exposes the identical control surface as the results
/// editor. Columns come from the bound query object's last run; edits are written
/// back through the pane's `onChange`.
///
/// The chart object's title lives on the object (it is the node header), not in
/// the spec. We surface it as `spec.title` for the editor and peel it back out on
/// write, so there is a single visible title and `spec.title` stays empty (the
/// chart itself draws no second heading inside its body).
function useCanvasChartEditor(
  tabId: string,
  component: ChartComponent,
  onChange: (patch: Partial<ChartComponent>) => void,
): ChartEditorPanelViewModel {
  const result = useCanvasStore(
    (s) => s.boards[tabId]?.runs[component.sourceQueryId]?.result,
  );
  const columns = useMemo(
    () => result?.columns.map((column) => column.name) ?? [],
    [result],
  );

  return useMemo(() => {
    const spec: ChartSpec = { ...component.spec, title: component.title ?? "" };
    const writeSpec = (next: ChartSpec) => {
      const { title, ...rest } = next;
      onChange({ title: title || undefined, spec: rest });
    };
    const resetSpec = () => writeSpec(defaultChartSpec(result));
    return buildChartEditorViewModel({ spec, columns, result, writeSpec, resetSpec });
  }, [component.spec, component.title, columns, result, onChange]);
}

export { useCanvasChartEditor };
