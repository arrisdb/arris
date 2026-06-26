import type { DbtSchemaSectionLabelProps } from "../../types";

function DbtSchemaSectionLabel({ children }: DbtSchemaSectionLabelProps) {
  return (
    <div className="mdbc-dbt-schema-section-title">
      {children}
    </div>
  );
}

export { DbtSchemaSectionLabel };
