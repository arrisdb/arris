import { apiCall } from "@shared/api";
import type { ProjectManifest } from "./types";

function listProjectsIPC(): Promise<ProjectManifest[]> {
  return apiCall("project_list");
}

export { listProjectsIPC };
