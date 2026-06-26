import { Field, FormRow } from "@shared/ui";
import type { FieldsProps } from "./types";

export function MixpanelFields({ config, patch }: FieldsProps) {
  return (
    <>
      <FormRow label="Project ID">
        <Field value={config.database} onChange={(v) => patch("database", v)} monospace placeholder="Mixpanel project ID" />
      </FormRow>
      <FormRow label="SA Username">
        <Field value={config.user} onChange={(v) => patch("user", v)} monospace placeholder="Service account username" />
      </FormRow>
      <FormRow label="SA Secret">
        <Field type="password" value={config.password} onChange={(v) => patch("password", v)} monospace placeholder="Service account secret" />
      </FormRow>
    </>
  );
}
