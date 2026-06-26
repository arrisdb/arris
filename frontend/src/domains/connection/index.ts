import { registerPane } from "@shared";
import { registerTabView } from "@shared";
import type { EditorTab } from "@shell/types";
import { CombinedConnectionsTree } from "./components/CombinedConnectionsTree";
import { DefinitionTabView } from "./components/DefinitionTabView";
import { DatabaseKindIcon, kindStyle } from "./utils/databaseKindIcon";
import { useConnectionsStore, useSchemaUiStore } from "./hooks";

// The connections tree is the right rail's default: lowest priority and always
// eligible, so it shows whenever no higher-priority pane (agent, chart editor,
// pinned queries) is open.
function registerConnectionsPane(): void {
  registerPane({
    id: "connections",
    side: "right",
    kind: "primary",
    priority: 0,
    useActive: () => true,
    Component: CombinedConnectionsTree,
  });
}

// The editor renders `definition` tabs (a schema object's DDL, opened from the
// connection's schema browser) with the connection domain's view.
function registerDefinitionTabView(): void {
  registerTabView<EditorTab>({ tabType: "definition", Component: DefinitionTabView });
}

export {
  CombinedConnectionsTree,
  DatabaseKindIcon,
  DefinitionTabView,
  kindStyle,
  registerConnectionsPane,
  registerDefinitionTabView,
  useConnectionsStore,
  useSchemaUiStore,
};
export type {
  SchemaNode,
  ScopedConnection,
} from "./components/CombinedConnectionsTree/types";
