import type { DbtNodeKind } from "../DbtProjectPane/types";

const DBT_SIDEBAR_EMPTY_TEXT = "No dbt project open. Open a folder containing `dbt_project.yml`.";

const DBT_SIDEBAR_SECTIONS: { key: DbtNodeKind; label: string }[] = [
  { key: "model", label: "Models" },
  { key: "source", label: "Sources" },
  { key: "seed", label: "Seeds" },
  { key: "snapshot", label: "Snapshots" },
  { key: "test", label: "Tests" },
  { key: "exposure", label: "Exposures" },
  { key: "metric", label: "Metrics" },
  { key: "macro", label: "Macros" },
  { key: "analysis", label: "Analyses" },
];

export {
  DBT_SIDEBAR_EMPTY_TEXT,
  DBT_SIDEBAR_SECTIONS,
};
