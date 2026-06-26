import { Btn, Chip } from "@shared/ui";
import {
  DBT_SCHEMA_COLUMNS_LABEL,
  DBT_SCHEMA_DEPENDS_ON_LABEL,
  DBT_SCHEMA_EMPTY_TEXT,
  DBT_SCHEMA_NO_DESCRIPTION_TEXT,
} from "./constants";
import { useDbtSchemaPane } from "./hooks";
import { DbtSchemaColumnsTable } from "./components/DbtSchemaColumnsTable";
import { DbtSchemaDependsOnList } from "./components/DbtSchemaDependsOnList";
import { DbtSchemaSectionLabel } from "./components/DbtSchemaSectionLabel";
import type { DbtSchemaPaneProps } from "./types";
import { dbtSchemaLocation } from "./utils";

export function DbtSchemaPane({ onShowLineage }: DbtSchemaPaneProps) {
  const pane = useDbtSchemaPane({ onShowLineage });

  if (!pane.node) {
    return (
      <div className="mdbc-dbt-schema-empty">
        {DBT_SCHEMA_EMPTY_TEXT}
      </div>
    );
  }

  return (
    <div className="mdbc-dbt-schema-scroll">
      <div className="mdbc-dbt-schema-title-row">
        <span className="mdbc-dbt-schema-title">{pane.node.name}</span>
        <Chip>{pane.node.kind}</Chip>
        {dbtSchemaLocation(pane.node) && (
          <span className="mdbc-dbt-schema-kind">
            {dbtSchemaLocation(pane.node)}
          </span>
        )}
      </div>
      <div className="mdbc-dbt-schema-description">
        {pane.node.description ?? <em className="mdbc-dbt-schema-muted">{DBT_SCHEMA_NO_DESCRIPTION_TEXT}</em>}
      </div>
      <div className="mdbc-dbt-schema-path">
        {pane.node.filePath}
      </div>

      <div className="mdbc-dbt-schema-actions">
        {pane.showLineageAction && (
          <Btn variant="ghost" onClick={pane.onClickLineage}>
            Lineage
          </Btn>
        )}
      </div>

      <DbtSchemaSectionLabel>{DBT_SCHEMA_DEPENDS_ON_LABEL}</DbtSchemaSectionLabel>
      <DbtSchemaDependsOnList dependsOn={pane.node.dependsOn} />

      <DbtSchemaSectionLabel>{DBT_SCHEMA_COLUMNS_LABEL}</DbtSchemaSectionLabel>
      <DbtSchemaColumnsTable columns={pane.node.columns} />
    </div>
  );
}
