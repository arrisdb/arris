import { registerPane } from "@shared";
import { usePinnedQueriesStore } from "./hooks";
import { PinnedQueriesPane } from "./components/PinnedQueriesPane";

function usePinnedQueriesPaneActive(): boolean {
  return usePinnedQueriesStore((state) => state.paneOpen);
}

function registerPinnedQueriesPane(): void {
  registerPane({
    id: "pinnedQueries",
    side: "right",
    kind: "primary",
    priority: 10,
    useActive: usePinnedQueriesPaneActive,
    Component: PinnedQueriesPane,
  });
}

export { PinnedQueriesPane, registerPinnedQueriesPane, usePinnedQueriesStore };
export { usePinnedQueryTabSync } from "./components/PinnedQueriesPane/hooks";
