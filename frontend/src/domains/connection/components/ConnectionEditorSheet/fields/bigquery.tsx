import { Field, FormRow, PathField } from "@shared/ui";
import type { FieldsProps } from "./types";

function BigqueryFields({ config, patch }: FieldsProps) {
  return (
    <>
      <FormRow label="Project ID">
        <Field value={config.database} onChange={(v) => patch("database", v)} monospace placeholder="my-gcp-project" />
      </FormRow>
      <FormRow label="Credentials File">
        <PathField
          value={config.credentialsFile ?? ""}
          onChange={(v) => patch("credentialsFile", v)}
          placeholder="/path/to/service-account.json"
          filters={[{ name: "JSON", extensions: ["json"] }]}
          title="Select service account credentials"
          testId="bigquery-credentials-browse"
        />
      </FormRow>
      <FormRow label="Options">
        <Field value={config.options} onChange={(v) => patch("options", v)} monospace placeholder="key=val&key=val" />
      </FormRow>
    </>
  );
}

export { BigqueryFields };
