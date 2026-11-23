import { DIR_QUERY_PARAM } from "../constants";

/// The dbt / SQLMesh subfolder the page was opened for; null means the project root.
function currentDir(): string | null {
  return new URLSearchParams(window.location.search).get(DIR_QUERY_PARAM);
}

export { currentDir };
