import { PaneContextMenuSurface } from "@shared/ui/ContextMenu";
import { PINNED_QUERIES_CONTEXT_MENU_ITEMS } from "./constants";
import { usePinnedQueriesPane } from "./hooks";
import { PinnedQueriesContent } from "./components/PinnedQueriesContent";
import "./index.css";

function PinnedQueriesPane() {
  const pane = usePinnedQueriesPane();

  return (
    <>
      <div className="mdbc-pane-header">
        <span className="mdbc-pane-title">PINNED QUERIES</span>
      </div>
      <PaneContextMenuSurface
        className="mdbc-pinned-queries-scroll"
        context={null}
        getItems={PINNED_QUERIES_CONTEXT_MENU_ITEMS}
      >
        <PinnedQueriesContent pane={pane} />
      </PaneContextMenuSurface>
    </>
  );
}

export { PinnedQueriesPane };
