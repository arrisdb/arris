import { useFilesStore } from "../../hooks";
import { FileTreeView } from "../FileTreeView";
import { EmptyProjectPane } from "../EmptyProjectPane";

// The left rail's "Project" view: the file tree once a project is open, or the
// empty-state call to action before then.
function ProjectFilesPane() {
  const rootPath = useFilesStore((state) => state.rootPath);
  return rootPath ? <FileTreeView /> : <EmptyProjectPane />;
}

export { ProjectFilesPane };
