import type { Extension } from "@codemirror/state";

import type { DatabaseKind, SchemaNode } from "@shared";
import { editorCompletionExtensions } from "@domains/editor";
import { buildSqlSchema, deriveSchemaScoping } from "@domains/editor";
import { editorLanguageExtensions } from "@domains/editor";

interface SqlSupportInput {
  connectionKind: DatabaseKind | undefined;
  schemaNodes: SchemaNode[] | undefined;
  fontSize: number;
}

// Builds the exact same SQL dialect + schema-aware completion the SQL editor uses
// (`editorLanguageExtensions` + `editorCompletionExtensions`), so a notebook SQL
// cell gets identical keyword/table/column suggestions for its chosen connection.
// No completion logic is duplicated here: this only feeds the connection's schema
// tree into the shared builders. Returns an empty list when no connection/schema is
// available yet, leaving the cell with plain SQL highlighting until the schema loads.
function buildSqlCellSupport(input: SqlSupportInput): Extension[] {
  const { connectionKind, schemaNodes, fontSize } = input;
  const schema = schemaNodes ? buildSqlSchema(schemaNodes) : {};
  const scoping = schemaNodes
    ? deriveSchemaScoping(schemaNodes)
    : { catalogQualified: false, schemaNames: [] as string[] };
  return [
    ...editorLanguageExtensions({ languageId: "sql", connectionKind }),
    ...editorCompletionExtensions({
      languageId: "sql",
      readOnly: false,
      fontSize,
      initialDoc: "",
      connectionKind,
      schema,
      schemaNames: scoping.schemaNames,
      catalogQualified: scoping.catalogQualified,
    }),
  ];
}

export { buildSqlCellSupport };
export type { SqlSupportInput };
