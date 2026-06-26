import { useGitChangesPane } from "./hooks";
import { GitChangesPaneContent } from "./components/GitChangesPaneContent";
import "./index.css";

function GitChangesPane() {
  const pane = useGitChangesPane();

  return (
    <div className="mdbc-git-changes-root">
      <GitChangesPaneContent pane={pane} />
    </div>
  );
}

export { GitChangesPane };
