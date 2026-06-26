import { Spinner } from "@shared/ui/Spinner";
import "./index.css";

function ProjectLoadingScreen() {
  return (
    <div className="mdbc project-loading-screen" data-testid="project-loading-screen">
      <div className="project-loading-content">
        <Spinner size={20} />
        <span className="project-loading-label">Opening project…</span>
      </div>
    </div>
  );
}

export { ProjectLoadingScreen };
