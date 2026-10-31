import { PROJECT_QUERY_PARAM } from "@shared/api";
import { PATH_SEPARATOR } from "./constants";

function projectLabel(root: string): string {
  return root.split(PATH_SEPARATOR).filter(Boolean).pop() ?? root;
}

// Starts at the root: a deep link's run or canvas belongs to the previous project.
function projectUrl(root: string): string {
  return `${PATH_SEPARATOR}?${new URLSearchParams({ [PROJECT_QUERY_PARAM]: root })}`;
}

export { projectLabel, projectUrl };
