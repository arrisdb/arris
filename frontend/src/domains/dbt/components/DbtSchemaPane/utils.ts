import type { DbtNode } from "../DbtProjectPane/types";

function dbtDependencyLabel(uniqueId: string): string {
  return uniqueId.split(".").pop() ?? uniqueId;
}

function dbtSchemaLocation(node: DbtNode): string | null {
  if (!node.schema) return null;
  return `${node.database ? `${node.database}.` : ""}${node.schema}`;
}

export {
  dbtDependencyLabel,
  dbtSchemaLocation,
};
