import { registerAgentPane } from "@domains/agent";
import { registerConnectionsPane, registerDefinitionTabView } from "@domains/connection";
import { registerChartPane } from "@domains/chart";
import { registerPinnedQueriesPane } from "@domains/pinnedQueries";
import { registerConsolesSection } from "@domains/console";
import { registerNotebookSection, registerNotebookTabView } from "@domains/notebook";
import { registerFilesPane, registerMediaTabView } from "@domains/files";
import { registerDbtPane } from "@domains/dbt";
import { registerSqlMeshPane } from "@domains/sqlmesh";
import { registerGitPane, registerGitTabViews } from "@domains/git";

// Composition root for domain contributions. This is the only place the shell
// enumerates which domains contribute a sidebar pane or an editor tab view; it
// holds no rendering or priority logic; each domain's registration owns that.
// The rails and the editor tab router read the populated registries and resolve
// what to show. Runs once on first import (the rails and the editor side-effect
// import this module), guarded against double registration.
let registered = false;

function registerPanes(): void {
  if (registered) return;
  registered = true;
  registerAgentPane();
  registerConnectionsPane();
  registerChartPane();
  registerPinnedQueriesPane();
  registerConsolesSection();
  registerNotebookSection();
  registerFilesPane();
  registerDbtPane();
  registerSqlMeshPane();
  registerGitPane();
  // Editor tab views contributed by domains.
  registerNotebookTabView();
  registerGitTabViews();
  registerMediaTabView();
  registerDefinitionTabView();
}

registerPanes();

export { registerPanes };
