import type { SslMode } from "../../CombinedConnectionsTree/types";
import { Field, FormRow, Select, Toggle } from "@shared/ui";
import { SshSection } from "./sshSection";
import { UriSection } from "./uriSection";
import type { FieldsProps } from "./types";
import { SSL_MODES } from "./types";

export function MongoDBFields({ config, patch, showSsh, setShowSsh, uri, onUriChange }: FieldsProps) {
  return (
    <>
      <FormRow label="Host">
        <Field value={config.host} onChange={(v) => patch("host", v)} monospace />
      </FormRow>
      <FormRow label="Port">
        <Field value={String(config.port)} onChange={(v) => patch("port", Number(v) || 0)} monospace />
      </FormRow>
      <FormRow label="Database">
        <Field value={config.database} onChange={(v) => patch("database", v)} monospace />
      </FormRow>
      <FormRow label="User">
        <Field value={config.user} onChange={(v) => patch("user", v)} monospace />
      </FormRow>
      <FormRow label="Password">
        <Field type="password" value={config.password} onChange={(v) => patch("password", v)} monospace />
      </FormRow>
      <FormRow label="SSL Mode">
        <Select
          value={config.sslMode}
          options={SSL_MODES.map((m) => ({ value: m, label: m }))}
          onChange={(v) => patch("sslMode", v as SslMode)}
        />
      </FormRow>
      <FormRow label="SRV">
        <Toggle checked={config.isSRV} onChange={(v) => patch("isSRV", v)} ariaLabel="SRV" />
      </FormRow>
      <FormRow label="Options">
        <Field value={config.options} onChange={(v) => patch("options", v)} placeholder="key1=val1&key2=val2" monospace />
      </FormRow>
      <SshSection config={config} patch={patch} showSsh={showSsh} setShowSsh={setShowSsh} />
      <UriSection config={config} uri={uri} onUriChange={onUriChange} />
    </>
  );
}
