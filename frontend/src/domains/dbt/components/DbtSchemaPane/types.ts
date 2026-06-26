import type { DbtNode } from "../DbtProjectPane/types";

interface DbtSchemaPaneProps {
  onShowLineage?: (uniqueId: string) => void;
}

interface DbtSchemaPaneViewModel {
  node: DbtNode | null;
  onClickLineage: () => void;
  showLineageAction: boolean;
}

interface DbtSchemaSectionLabelProps {
  children: string;
}

interface DbtSchemaDependsOnListProps {
  dependsOn: string[];
}

interface DbtSchemaColumnsTableProps {
  columns: DbtNode["columns"];
}

export type {
  DbtSchemaColumnsTableProps,
  DbtSchemaDependsOnListProps,
  DbtSchemaPaneProps,
  DbtSchemaPaneViewModel,
  DbtSchemaSectionLabelProps,
};
