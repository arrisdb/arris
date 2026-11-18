import { useEffect, useState } from "react";
import { listProjectsIPC } from "./ipc";
import type { ProjectManifest } from "./types";

function useProjects(): ProjectManifest[] {
  const [projects, setProjects] = useState<ProjectManifest[]>([]);
  useEffect(() => {
    listProjectsIPC()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);
  return projects;
}

export { useProjects };
