import { DBT_SCHEMA_PLACEHOLDER } from "../../constants";
import type { DbtSchemaColumnsTableProps } from "../../types";

function DbtSchemaColumnsTable({ columns }: DbtSchemaColumnsTableProps) {
  if (!columns || columns.length === 0) {
    return <div className="mdbc-dbt-schema-placeholder">{DBT_SCHEMA_PLACEHOLDER}</div>;
  }

  return (
    <table className="mdbc-dbt-schema-table">
      <tbody>
        {columns.map((column) => (
          <tr key={column.name}>
            <td className="mdbc-dbt-schema-table-key">
              {column.name}
              {column.type && (
                <span className="mdbc-dbt-schema-table-meta">
                  {column.type}
                </span>
              )}
            </td>
            <td className="mdbc-dbt-schema-table-value">
              {column.description ?? ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export { DbtSchemaColumnsTable };
