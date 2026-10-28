import { PaneContextMenuSurface } from "@shared/ui/ContextMenu";
import { PINNED_QUERIES_CONTEXT_MENU_ITEMS } from "./constants";
import { usePinnedQueriesPane } from "./hooks";
import { PinnedQueriesContent } from "./components/PinnedQueriesContent";
import type { PinnedQueriesPaneProps } from "./types";
import "./index.css";

/// `onOpenQuery` replaces the desktop default of opening the pin in an editor tab.
function PinnedQueriesPane({ onOpenQuery }: PinnedQueriesPaneProps = {}) {
  const pane = usePinnedQueriesPane(onOpenQuery);

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
