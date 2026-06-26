import { Field, FormRow } from "@shared/ui";
import type { FieldsProps } from "./types";

// DynamoDB has no host/port/database. The generic ConnectionConfig slots are
// reused: database = region, user = access key id, password = secret key,
// options = session token, host = endpoint URL (for DynamoDB Local / VPC).
export function DynamoDBFields({ config, patch }: FieldsProps) {
  return (
    <>
      <FormRow label="Region">
        <Field value={config.database} onChange={(v) => patch("database", v)} placeholder="us-east-1" monospace />
      </FormRow>
      <FormRow label="Access Key ID">
        <Field value={config.user} onChange={(v) => patch("user", v)} placeholder="optional, uses default chain" monospace />
      </FormRow>
      <FormRow label="Secret Access Key">
        <Field type="password" value={config.password} onChange={(v) => patch("password", v)} monospace />
      </FormRow>
      <FormRow label="Session Token">
        <Field value={config.options} onChange={(v) => patch("options", v)} placeholder="optional" monospace />
      </FormRow>
      <FormRow label="Endpoint URL">
        <Field value={config.host} onChange={(v) => patch("host", v)} placeholder="https://dynamodb.us-east-1.amazonaws.com" monospace />
      </FormRow>
    </>
  );
}
