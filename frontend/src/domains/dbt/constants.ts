// File-system markers that identify a dbt project root: any of these present at
// a directory makes it a dbt project. Domain-owned single source of truth,
// consumed by the project store, the left rail, and the dbt pane.
const DBT_PROJECT_MARKERS = ["dbt_project.yml"];

export { DBT_PROJECT_MARKERS };
