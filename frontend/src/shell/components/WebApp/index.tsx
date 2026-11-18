import { Suspense } from "react";
import {
  AnalyticsNav,
  LineagePanel,
  ModelView,
  ModelsView,
  ToolRunsView,
} from "@domains/analytics";
import type { AnalyticsSection, AnalyticsTool } from "@domains/analytics";
import { CanvasListView, CanvasView, SendToCanvasMenu } from "@domains/canvas";
import { CombinedConnectionsTree } from "@domains/connection";
import { HistoryView } from "@domains/history";
import { PinnedQueriesPane } from "@domains/pinnedQueries";
import { RunResultView } from "@domains/results";
import { currentProject } from "@shared/api";
import { ConnectionRequestPage } from "../ConnectionRequestPage";
import { analyticsPath, canvasPath, navigate, runPath, useRoute } from "../../utils";
import type { WebRoute } from "../../utils";
import { ProjectSwitcher } from "./components/ProjectSwitcher";
import { WebSidebar } from "./components/WebSidebar";
import {
  NO_PROJECT_MESSAGE,
  WEB_APP_TEST_ID,
  WIDE_ROUTES,
} from "./constants";
import { useAnalyticsTools, useConnectionList, useOpenPin, usePins } from "./hooks";
import "./index.css";

// Run pages and history rows can put a run's query on a canvas.
const sendToCanvas = (runId: string) => (
  <SendToCanvasMenu runId={runId} onSent={(id) => navigate(canvasPath(id))} />
);

const SECTION_OF: Partial<Record<WebRoute["kind"], AnalyticsSection>> = {
  models: "models",
  model: "models",
  lineage: "lineage",
  toolRuns: "runs",
  toolRun: "runs",
};

// dbt and sqlmesh pages: the section switch above the page for that route.
function AnalyticsPage({ tool, route }: { tool: AnalyticsTool; route: WebRoute }) {
  const openModel = (name: string) => navigate(analyticsPath(tool, "models", name));
  const page = (() => {
    switch (route.kind) {
      case "model":
        return <ModelView key={route.name} tool={tool} name={route.name} onOpenModel={openModel} />;
      case "lineage":
        return (
          <LineagePanel key={route.name} tool={tool} name={route.name} onOpenModel={openModel} />
        );
      case "toolRuns":
      case "toolRun":
        return (
          <ToolRunsView
            tool={tool}
            runId={route.kind === "toolRun" ? route.runId : null}
            onOpenRun={(id) => navigate(analyticsPath(tool, "runs", id))}
          />
        );
      default:
        return <ModelsView tool={tool} onOpenModel={openModel} />;
    }
  })();
  return (
    <>
      <AnalyticsNav
        tool={tool}
        section={SECTION_OF[route.kind] ?? "models"}
        onSelect={(section) => navigate(analyticsPath(tool, section))}
      />
      <Suspense fallback={null}>{page}</Suspense>
    </>
  );
}

function PinnedPage() {
  const { openPin, pinError } = useOpenPin();
  return (
    <>
      {pinError && <p className="mdbc-web-error">{pinError}</p>}
      <PinnedQueriesPane onOpenQuery={openPin} />
    </>
  );
}

function RouteView({ route, listError }: { route: WebRoute; listError: string | null }) {
  if ("tool" in route) return <AnalyticsPage tool={route.tool} route={route} />;
  switch (route.kind) {
    case "connections":
      return (
        <>
          {listError && <p className="mdbc-web-error">{listError}</p>}
          <CombinedConnectionsTree />
        </>
      );
    case "run":
      return (
        <RunResultView
          key={route.runId}
          runId={route.runId}
          onOpenRun={(runId) => navigate(runPath(runId))}
          runActions={sendToCanvas}
        />
      );
    case "canvases":
      return <CanvasListView onOpenCanvas={(id) => navigate(canvasPath(id))} />;
    case "canvas":
      return (
        <Suspense fallback={null}>
          <CanvasView key={route.canvasId} canvasId={route.canvasId} />
        </Suspense>
      );
    case "pinned":
      return <PinnedPage />;
    default:
      return (
        <HistoryView onOpenRun={(runId) => navigate(runPath(runId))} runActions={sendToCanvas} />
      );
  }
}

function WebApp() {
  const route = useRoute();
  const project = currentProject();
  const tools = useAnalyticsTools(project);
  const listError = useConnectionList(
    route.kind !== "connectionRequest" && project !== null,
  );
  usePins(route.kind === "pinned" && project !== null);

  if (route.kind === "connectionRequest") return <ConnectionRequestPage />;
  return (
    <div className="mdbc-web-app" data-testid={WEB_APP_TEST_ID}>
      <WebSidebar route={route} switcher={<ProjectSwitcher />} tools={tools} />
      <main className={`mdbc-web-main${WIDE_ROUTES.has(route.kind) ? " board" : ""}`}>
        {project ? (
          <RouteView route={route} listError={listError} />
        ) : (
          <p className="mdbc-web-empty">{NO_PROJECT_MESSAGE}</p>
        )}
      </main>
    </div>
  );
}

export { WebApp };
