import type { SaslMechanism, SslMode } from "../../CombinedConnectionsTree/types";
import { Field, FormRow, Select } from "@shared/ui";
import { SshSection } from "./sshSection";
import { UriSection } from "./uriSection";
import type { FieldsProps } from "./types";
import { SSL_MODES } from "./types";

const SASL_MECHANISMS: SaslMechanism[] = [
  "none",
  "PLAIN",
  "SCRAM-SHA-256",
  "SCRAM-SHA-512",
];

export function KafkaFields({ config, patch, showSsh, setShowSsh, uri, onUriChange }: FieldsProps) {
  return (
    <>
      <FormRow label="Host">
        <Field value={config.host} onChange={(v) => patch("host", v)} monospace />
      </FormRow>
      <FormRow label="Port">
        <Field value={String(config.port)} onChange={(v) => patch("port", Number(v) || 0)} monospace />
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
      <FormRow label="Schema Reg">
        <Field
          value={config.schemaRegistryURL ?? ""}
          onChange={(v) => patch("schemaRegistryURL", v)}
          placeholder="http://localhost:8081"
          monospace
        />
      </FormRow>
      <FormRow label="SASL">
        <Select
          value={config.saslMechanism ?? "none"}
          options={SASL_MECHANISMS.map((m) => ({ value: m, label: m === "none" ? "None" : m }))}
          onChange={(v) => patch("saslMechanism", v as SaslMechanism)}
        />
      </FormRow>
      <FormRow label="Options">
        <Field value={config.options} onChange={(v) => patch("options", v)} placeholder="key1=val1&key2=val2" monospace />
      </FormRow>
      <SshSection config={config} patch={patch} showSsh={showSsh} setShowSsh={setShowSsh} />
      <UriSection config={config} uri={uri} onUriChange={onUriChange} />
    </>
  );
}
