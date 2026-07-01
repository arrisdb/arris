import { useRunHistoryStore } from "@domains/results";
import { useCallback, useMemo } from "react";
import { useChartEditorStore } from "../../hooks/store";
import { useTabsStore } from "@shell/hooks/tabsStore";
import {
  selectActiveRun,
  selectLastSuccessfulResult,
} from "@domains/results";
import { defaultChartSpec } from "../ChartView/utils";
import type { ChartSpec } from "@shared";
import type { ChartEditorPanelViewModel } from "./types";
import { buildChartEditorViewModel } from "./utils";

function useChartEditorPanel(): ChartEditorPanelViewModel | null {
  const targetTabId = useChartEditorStore((state) => state.targetTabId);
  const tab = useTabsStore((state) =>
    targetTabId ? state.tabs.find((item) => item.id === targetTabId) : undefined,
  );
  const updateTab = useTabsStore((state) => state.updateTab);

  const activeRun = useRunHistoryStore((state) => selectActiveRun(tab, state));
  const lastSuccessResult = useRunHistoryStore((state) => selectLastSuccessfulResult(tab, state));
  const result = activeRun?.result ?? lastSuccessResult;

  const spec = tab?.chart ?? (result ? defaultChartSpec(result) : undefined);

  const columns = useMemo(
    () => result?.columns.map((column) => column.name) ?? [],
    [result],
  );

  const writeSpec = useCallback((next: ChartSpec) => {
    if (!targetTabId) return;
    updateTab(targetTabId, { chart: next });
  }, [targetTabId, updateTab]);

  const resetSpec = useCallback(() => {
    if (!targetTabId) return;
    updateTab(targetTabId, { chart: result ? defaultChartSpec(result) : undefined });
  }, [result, targetTabId, updateTab]);

  const pane = useMemo(
    () =>
      spec
        ? buildChartEditorViewModel({ spec, columns, result, writeSpec, resetSpec })
        : null,
    [spec, columns, result, writeSpec, resetSpec],
  );

  if (!targetTabId || !tab || !spec) return null;
  return pane;
}

export { useChartEditorPanel };
