import { PaneContextMenuSurface } from "@shared/ui/ContextMenu";
import { GIT_DIFF_CONTEXT_MENU_ITEMS } from "./constants";
import { useGitDiffView } from "./hooks";
import { GitDiffViewContent } from "./components/GitDiffViewContent";

function GitDiffView() {
  const pane = useGitDiffView();

  return (
    <PaneContextMenuSurface
      className="git-diff-view"
      context={null}
      getItems={GIT_DIFF_CONTEXT_MENU_ITEMS}
    >
      <GitDiffViewContent pane={pane} />
    </PaneContextMenuSurface>
  );
}

export { GitDiffView };
