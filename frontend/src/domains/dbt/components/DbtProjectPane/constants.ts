import type { DbtCommandKind } from "./types";
import type { DbtNodeKind } from "./types";
import type { DbtNodeSection } from "./types";

const DBT_SETTINGS_KEY = "dbt-settings";

const DBT_NODE_SECTIONS: DbtNodeSection[] = [
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

const DBT_KIND_COLORS: Record<DbtNodeKind | "default", string> = {
  model: "var(--m-accent)",
  source: "#5be39a",
  seed: "#ffd960",
  snapshot: "var(--m-accent-2)",
  test: "#ff7ab2",
  exposure: "#ffa14a",
  metric: "#7adce4",
  macro: "#a0a0aa",
  analysis: "#a0a0aa",
  default: "#a0a0aa",
};

const CLI_ERROR_PREVIEW_LINES = 3;

const RUN_COMMANDS: { kind: DbtCommandKind; label: string }[] = [
  { kind: "debug", label: "Debug" },
  { kind: "run", label: "Run" },
  { kind: "test", label: "Test" },
  { kind: "build", label: "Build" },
];

const SELECTOR_SYNTAX: { syntax: string; meaning: string }[] = [
  { syntax: "model", meaning: "Run a specific model" },
  { syntax: "model+", meaning: "Run model & its descendants" },
  { syntax: "+model", meaning: "Run model & its ancestors" },
  { syntax: "@model", meaning: "Run model, parents & children" },
];

export {
  CLI_ERROR_PREVIEW_LINES,
  RUN_COMMANDS,
  SELECTOR_SYNTAX,
  DBT_KIND_COLORS,
  DBT_NODE_SECTIONS,
  DBT_SETTINGS_KEY,
};
