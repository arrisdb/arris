import type { FilesPaneView } from "@shared/settings";

// The Files-tab subview selector (Project / dbt / SQLMesh). The panes
// themselves are registry contributions; this view-model only drives the
// segmented selector chrome the rail renders.
interface LeftSidebarSelector {
  dbtDetected: boolean;
  filesPaneView: FilesPaneView;
  onClickDbtView: () => void;
  onClickProjectView: () => void;
  onClickSqlMeshView: () => void;
  showSelector: boolean;
  sqlmeshDetected: boolean;
}

export type {
  LeftSidebarSelector,
};
