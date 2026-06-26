import { registerPane } from "@shared";
import { registerTabView } from "@shared";
import type { EditorTab } from "@shell/types";
import { useSettingsStore } from "@shared/settings";
import { FileSearchPopover } from "./components/FileSearchPopover";
import { FileTreeView } from "./components/FileTreeView";
import { EmptyProjectPane } from "./components/EmptyProjectPane";
import { ProjectFilesPane } from "./components/ProjectFilesPane";
import { MediaView } from "./components/MediaView";
import { fileKindForName, findProjectRoot, openPickedFile } from "./components/FileTreeView/utils";

function registerFilesPane(): void {
  registerPane({
    id: "filesProject",
    side: "left",
    kind: "primary",
    priority: 40,
    title: "Files",
    useActive: () =>
      useSettingsStore((s) => s.sidebarLeftTab === "files" && s.filesPaneView === "project"),
    Component: ProjectFilesPane,
  });
}

// The editor renders `media` tabs (image/asset previews) with the files
// domain's view.
function registerMediaTabView(): void {
  registerTabView<EditorTab>({ tabType: "media", Component: MediaView });
}

export {
  FileSearchPopover,
  FileTreeView,
  EmptyProjectPane,
  ProjectFilesPane,
  MediaView,
  fileKindForName,
  findProjectRoot,
  openPickedFile,
  registerFilesPane,
  registerMediaTabView,
};

export { useFilesStore } from "./hooks";
