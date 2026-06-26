import { registerPane } from "@shared";
import { registerTabView } from "@shared";
import type { EditorTab } from "@shell/types";
import { NotebookSection } from "./components/NotebookSection";
import { NotebookView } from "./components/NotebookView";
import { serializeNotebook, parseNotebook } from "./components/NotebookView/utils/nbformat";

// Stacked under the left rail's files/project view, below the consoles section.
function registerNotebookSection(): void {
  registerPane({
    id: "notebooks",
    side: "left",
    kind: "section",
    priority: 10,
    useActive: () => true,
    Component: NotebookSection,
  });
}

// The editor renders `notebook` tabs with the notebook domain's view.
function registerNotebookTabView(): void {
  registerTabView<EditorTab>({ tabType: "notebook", Component: NotebookView });
}

export {
  NotebookSection,
  NotebookView,
  serializeNotebook,
  parseNotebook,
  registerNotebookSection,
  registerNotebookTabView,
};
