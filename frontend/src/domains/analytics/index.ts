import { lazy } from "react";

export { AnalyticsNav } from "./components/AnalyticsNav";
export { ModelsView } from "./components/ModelsView";
export { ToolRunsView } from "./components/ToolRunsView";
export { ANALYTICS_TOOLS, DIR_QUERY_PARAM, TOOL_LABELS } from "./constants";
export { useAnalyticsTools } from "./hooks";
export { modelsIPC } from "./ipc";
export type { AnalyticsSection, AnalyticsTool } from "./types";

// reactflow is heavy; keep the graph pages out of the startup bundle.
const ModelView = lazy(() =>
  import("./components/ModelView").then((m) => ({ default: m.ModelView })),
);
const LineagePanel = lazy(() =>
  import("./components/LineagePanel").then((m) => ({ default: m.LineagePanel })),
);

export { LineagePanel, ModelView };
