import { useTabView } from "@shared";
import { CsvTableView } from "../CsvTableView";
import { ConsoleTabView } from "../ConsoleTabView";
import { TableTabView } from "../TableTabView";
import type { EditorTabRouterProps } from "./types";

function EditorTabRouter({
  activeTab,
  consoleProps,
  tableProps,
}: EditorTabRouterProps) {
  // Domain-contributed tab views resolve from the registry first; the built-in
  // cases below cover the prop-bound editor host (console default + table) and
  // the kind-keyed csv preview, none of which are domain contributions.
  const registered = useTabView(activeTab?.tabType);

  if (activeTab?.kind === "csv") {
    return <CsvTableView tab={activeTab} />;
  }

  if (registered) {
    const RegisteredView = registered.Component;
    const element = <RegisteredView activeTab={activeTab} />;
    return registered.wrap === false
      ? element
      : <div className="mdbc-tab-content">{element}</div>;
  }

  switch (activeTab?.tabType) {
    case "terminal":
      return null;
    case "table":
      return <TableTabView activeTab={activeTab} {...tableProps} />;
    default:
      return <ConsoleTabView activeTab={activeTab} {...consoleProps} />;
  }
}

export { EditorTabRouter };
