import { Suspense } from "react";
import { AnalyticsNav, LineagePanel, ModelView, ModelsView, ToolRunsView } from "@domains/analytics";
import type { AnalyticsSection } from "@domains/analytics";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { EditorTab } from "@shell/types";
import { analyticsPath, routeForPath } from "../../utils";
import type { WebRoute } from "../../utils";
import "./index.css";

const SECTION_OF: Partial<Record<WebRoute["kind"], AnalyticsSection>> = {
  models: "models",
  model: "models",
  lineage: "lineage",
  toolRuns: "runs",
  toolRun: "runs",
};

// One dbt or SQLMesh tab; moving between its pages rewrites the tab's path.
function AnalyticsTabView({ activeTab }: { activeTab: EditorTab }) {
  const route = routeForPath(activeTab.analyticsPath ?? "");
  if (!("tool" in route)) return null;
  const { tool } = route;
  const open = (path: string) => useTabsStore.getState().openAnalyticsTab(tool, path);
  const openModel = (name: string) => open(analyticsPath(tool, "models", name));
  const page = (() => {
    switch (route.kind) {
      case "model":
        return <ModelView key={route.name} tool={tool} name={route.name} onOpenModel={openModel} />;
      case "lineage":
        return <LineagePanel key={route.name} tool={tool} name={route.name} onOpenModel={openModel} />;
      case "toolRuns":
      case "toolRun":
        return (
          <ToolRunsView
            tool={tool}
            runId={route.kind === "toolRun" ? route.runId : null}
            onOpenRun={(id) => open(analyticsPath(tool, "runs", id))}
          />
        );
      default:
        return <ModelsView tool={tool} onOpenModel={openModel} />;
    }
  })();
  return (
    <div className="mdbc-analytics-tab">
      <AnalyticsNav
        tool={tool}
        section={SECTION_OF[route.kind] ?? "models"}
        onSelect={(section) => open(analyticsPath(tool, section))}
      />
      <Suspense fallback={null}>{page}</Suspense>
    </div>
  );
}

export { AnalyticsTabView };
