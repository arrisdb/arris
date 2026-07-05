const FILE_TREE_DBT_MARKERS = ["dbt_project.yml"];
const FILE_TREE_SQLMESH_MARKERS = ["config.yaml", "config.yml"];

// Filenames (lowercased) that open with the Makefile grammar; `*.mk`/`*.make`/
// `*.makefile` extensions are handled alongside these.
const FILE_KIND_MAKEFILE_NAMES: ReadonlySet<string> = new Set([
  "makefile",
  "gnumakefile",
]);

// Ignore-file names (lowercased) that share the `.gitignore` glob grammar.
const FILE_KIND_GITIGNORE_NAMES: ReadonlySet<string> = new Set([
  ".gitignore",
  ".dockerignore",
  ".npmignore",
  ".eslintignore",
  ".prettierignore",
]);

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
  FILE_KIND_GITIGNORE_NAMES,
  FILE_KIND_MAKEFILE_NAMES,
  FILE_TREE_DBT_MARKERS,
  FILE_TREE_DEFAULT_EXPANDED_DIRS,
  FILE_TREE_SQLMESH_MARKERS,
};
