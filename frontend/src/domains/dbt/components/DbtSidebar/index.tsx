import { PaneContextMenuSurface } from "@shared/ui/ContextMenu";
import {
  DBT_SIDEBAR_EMPTY_TEXT,
  DBT_SIDEBAR_SECTIONS,
} from "./constants";
import { useDbtSidebar } from "./hooks";
import { DbtSidebarSection } from "./components/DbtSidebarSection";
import { dbtSidebarContextMenuItems } from "./utils";

export function DbtSidebar() {
  const sidebar = useDbtSidebar();

  if (!sidebar.project) {
    return (
      <div className="mdbc-dbt-sidebar-empty">
        {DBT_SIDEBAR_EMPTY_TEXT}
      </div>
    );
  }

  return (
    <PaneContextMenuSurface
      className="mdbc-pane-body"
      context={null}
      getItems={dbtSidebarContextMenuItems}
    >
      <div className="mdbc-pane-header mdbc-dbt-sidebar-header">
        <div className="mdbc-dbt-sidebar-title">{sidebar.project.name}</div>
        <div className="mdbc-dbt-sidebar-subtitle">
          {sidebar.project.profile}
        </div>
      </div>
      {DBT_SIDEBAR_SECTIONS.map(({ key, label }) => (
        <DbtSidebarSection
          key={key}
          kind={key}
          label={label}
          items={sidebar.grouped[key]}
          collapsed={sidebar.collapsed[key]}
          selectedId={sidebar.selectedId}
          onClickSection={sidebar.onClickSection}
          onSelectNode={sidebar.onSelectNode}
        />
      ))}
    </PaneContextMenuSurface>
  );
}
