import "@shell";
import { useRailContent } from "@shared";
import { isWebShell } from "@shared/api";
import { ModelsView } from "@domains/analytics";
import {
  PaneContextMenuSurface,
} from "@shared/ui/ContextMenu";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { analyticsPath } from "../../utils";
import { WEB_PROJECT_TITLE } from "./constants";
import { useLeftSidebarState } from "./hooks";
import { leftPaneContextMenuItems } from "./utils";

// The browser swaps the file tree for the server's model lists; the project view
// is just the sections, so it renders no body at all.
function WebModels({ view }: { view: string }) {
  if (view !== "dbt" && view !== "sqlmesh") return null;
  return (
    <div className="mdbc-pane-body" data-testid="left-sidebar-body">
      <ModelsView
        tool={view}
        onOpenModel={(name) =>
          useTabsStore.getState().openAnalyticsTab(view, analyticsPath(view, "models", name))
        }
      />
    </div>
  );
}

// Generic left rail: renders the active left primary the registry resolves
// (files/dbt/SQLMesh/git) plus any active sections. The only rail-specific
// chrome left here is the Files subview selector: composition that spans the
// files/dbt/SQLMesh domains and so belongs to the shell, not any one domain.
export function LeftSidebar() {
  const { primary, sections } = useRailContent("left");
  const {
    filesPaneView,
    onClickDbtView,
    onClickProjectView,
    onClickSqlMeshView,
    dbtDetected,
    sqlmeshDetected,
    showSelector,
  } = useLeftSidebarState();
  const Primary = primary?.Component;

  return (
    <PaneContextMenuSurface
      className="mdbc-pane left"
      context={null}
      getItems={leftPaneContextMenuItems}
    >
      <div className="mdbc-pane-header">
        {showSelector ? (
          <span className="mdbc-segmented" data-testid="files-pane-selector">
            <button
              type="button"
              className={filesPaneView === "project" ? "active" : ""}
              onClick={onClickProjectView}
            >
              Project
            </button>
            {dbtDetected && (
              <button
                type="button"
                className={filesPaneView === "dbt" ? "active" : ""}
                onClick={onClickDbtView}
              >
                dbt
              </button>
            )}
            {sqlmeshDetected && (
              <button
                type="button"
                className={filesPaneView === "sqlmesh" ? "active" : ""}
                onClick={onClickSqlMeshView}
              >
                SQLMesh
              </button>
            )}
          </span>
        ) : (
          <span className="mdbc-pane-title">{isWebShell() ? WEB_PROJECT_TITLE : primary?.title}</span>
        )}
      </div>
      {isWebShell() ? (
        <WebModels view={filesPaneView} />
      ) : (
        <div className="mdbc-pane-body" data-testid="left-sidebar-body">
          {Primary && <Primary />}
        </div>
      )}
      {primary?.id === "filesProject" &&
        sections.map((section) => {
          const Section = section.Component;
          return <Section key={section.id} />;
        })}
    </PaneContextMenuSurface>
  );
}
