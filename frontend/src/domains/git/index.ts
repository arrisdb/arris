import { registerPane } from "@shared";
import { registerTabView } from "@shared";
import type { EditorTab } from "@shell/types";
import { useSettingsStore } from "@shared/settings";
import { GitChangesPane } from "./components/GitChangesPane";
import { GitDiffView } from "./components/GitDiffView";
import { CommitDiffView } from "./components/CommitDiffView";
import { GitHistoryView } from "./components/GitHistoryView";
import { GitConflictView } from "./components/GitConflictView";

function registerGitPane(): void {
  registerPane({
    id: "git",
    side: "left",
    kind: "primary",
    priority: 10,
    title: "Source Control",
    useActive: () => useSettingsStore((s) => s.sidebarLeftTab === "git"),
    Component: GitChangesPane,
  });
}

// The editor renders git tabs (working-tree diff, commit diff, history,
// conflict) with the git domain's views. Only the commit diff reads the active
// tab; the rest pull their state from the git store.
function registerGitTabViews(): void {
  registerTabView<EditorTab>({ tabType: "gitdiff", Component: GitDiffView });
  registerTabView<EditorTab>({ tabType: "gitcommitdiff", Component: CommitDiffView });
  registerTabView<EditorTab>({ tabType: "githistory", Component: GitHistoryView });
  registerTabView<EditorTab>({ tabType: "gitconflict", Component: GitConflictView });
}

export {
  GitChangesPane,
  GitDiffView,
  CommitDiffView,
  GitHistoryView,
  GitConflictView,
  registerGitPane,
  registerGitTabViews,
};

export { useGitStore } from "./hooks";
