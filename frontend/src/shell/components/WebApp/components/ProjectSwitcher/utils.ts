import { PROJECT_QUERY_PARAM } from "@shared/api";
import { HISTORY_PATH, RUN_PATH_PREFIX } from "../../../../utils";
import { PATH_SEPARATOR } from "./constants";

function projectLabel(root: string): string {
  return root.split(PATH_SEPARATOR).filter(Boolean).pop() ?? root;
}

function projectUrl(pathname: string, root: string): string {
  // A run id belongs to one project, so its page would 404 under the new one.
  const path = pathname.startsWith(RUN_PATH_PREFIX) ? HISTORY_PATH : pathname;
  return `${path}?${new URLSearchParams({ [PROJECT_QUERY_PARAM]: root })}`;
}

export { projectLabel, projectUrl };
