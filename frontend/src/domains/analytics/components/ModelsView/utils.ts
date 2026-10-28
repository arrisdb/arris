import type { ModelSummary } from "../../types";

/// Case-insensitive match on name or path; an empty query keeps every model.
function filterModels(models: ModelSummary[], query: string): ModelSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return models;
  return models.filter(
    (m) => m.name.toLowerCase().includes(needle) || m.path.toLowerCase().includes(needle),
  );
}

/// The per-tool badge: dbt materialization, sqlmesh model kind.
function modelBadge(model: ModelSummary): string {
  return model.materialized ?? model.kind ?? "";
}

export { filterModels, modelBadge };
