import { Chip } from "@shared/ui";
import { DBT_SCHEMA_PLACEHOLDER } from "../../constants";
import type { DbtSchemaDependsOnListProps } from "../../types";
import { dbtDependencyLabel } from "../../utils";

function DbtSchemaDependsOnList({ dependsOn }: DbtSchemaDependsOnListProps) {
  return (
    <div className="mdbc-dbt-schema-chip-list">
      {dependsOn.length === 0 ? (
        <span className="mdbc-dbt-schema-placeholder">{DBT_SCHEMA_PLACEHOLDER}</span>
      ) : (
        dependsOn.map((dependency) => (
          <Chip key={dependency}>{dbtDependencyLabel(dependency)}</Chip>
        ))
      )}
    </div>
  );
}

export { DbtSchemaDependsOnList };
