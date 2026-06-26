import { registerPane } from "@shared";
import { useSettingsStore } from "@shared/settings";
import { DbtSidebar } from "./components/DbtSidebar";
import { DbtDiffView } from "./components/DbtDiffView";
import { DbtToolbar } from "./components/DbtToolbar";
import { DbtDocsPreview } from "./components/DbtDocsPreview";
import { DbtProjectPane } from "./components/DbtProjectPane";
import { dbtReferenceAt } from "./utils/navigation/dbtReference";
import { DBT_PROJECT_MARKERS } from "./constants";
import {
  dbtDefinitionOffset,
  dbtDocRefForName,
  dbtMacroRefForName,
  dbtModelNodeForRef,
  dbtNodeCanContainRefs,
  dbtSourceNodeForRef,
  openDbtFile,
} from "./utils/navigation/dbtNavigation";

function registerDbtPane(): void {
  registerPane({
    id: "dbt",
    side: "left",
    kind: "primary",
    priority: 30,
    title: "dbt",
    useActive: () =>
      useSettingsStore((s) => s.sidebarLeftTab === "files" && s.filesPaneView === "dbt"),
    Component: DbtProjectPane,
  });
}

export {
  DbtSidebar,
  DbtDiffView,
  DbtToolbar,
  DbtDocsPreview,
  dbtReferenceAt,
  dbtDefinitionOffset,
  dbtDocRefForName,
  dbtMacroRefForName,
  dbtModelNodeForRef,
  dbtNodeCanContainRefs,
  dbtSourceNodeForRef,
  openDbtFile,
  registerDbtPane,
  DBT_PROJECT_MARKERS,
};

export { useDbtStore } from "./hooks";

export type { DbtNode, DbtRef } from "./components/DbtProjectPane/types";
export type { DbtReference } from "./utils/navigation/dbtReference";
