import type { Completion } from "@codemirror/autocomplete";

interface SqlMeshModelEntry {
  name: string;
  columns?: { name: string; description?: string; type?: string }[];
}

function detectSqlMeshFromJoin(text: string, pos: number): { prefix: string; from: number } | null {
  const before = text.slice(0, pos);
  const match = before.match(/(?:FROM|JOIN)\s+(\w*)$/i);
  if (!match) return null;
  const prefix = match[1];
  return { prefix, from: pos - prefix.length };
}

function buildSqlMeshFromJoinCompletions(
  models: SqlMeshModelEntry[],
  prefix: string,
): Completion[] {
  return models
    .filter((m) => m.name.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((m) => ({
      label: m.name,
      type: "variable",
      boost: 10,
    }));
}

export {
  buildSqlMeshFromJoinCompletions,
  detectSqlMeshFromJoin,
};

export type {
  SqlMeshModelEntry,
};
