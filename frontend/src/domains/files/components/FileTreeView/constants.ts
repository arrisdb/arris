const FILE_TREE_DBT_MARKERS = ["dbt_project.yml"];
const FILE_TREE_SQLMESH_MARKERS = ["config.yaml", "config.yml"];

const FILE_TREE_DEFAULT_EXPANDED_DIRS = [
  "models",
  "marts",
  "staging",
  "intermediate",
  "tests",
  "macros",
  "seeds",
  "snapshots",
  "analyses",
  "audits",
];

export {
  FILE_TREE_DBT_MARKERS,
  FILE_TREE_DEFAULT_EXPANDED_DIRS,
  FILE_TREE_SQLMESH_MARKERS,
};
