import type { SslMode } from "../../CombinedConnectionsTree/types";
import { Field, FormRow, Select } from "@shared/ui";
import { SshSection } from "./sshSection";
import type { FieldsProps } from "./types";
import { SSL_MODES } from "./types";
import { CertFields } from "./certFields";

function parseOptions(raw: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pair of raw.split("&")) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    map[pair.slice(0, idx).toLowerCase()] = pair.slice(idx + 1);
  }
  return map;
}

function serializeOptions(map: Record<string, string>): string {
  return Object.entries(map)
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

function patchOption(
  options: string,
  key: string,
  value: string,
  patch: FieldsProps["patch"],
): void {
  const map = parseOptions(options);
  map[key] = value;
  patch("options", serializeOptions(map));
}

function TrinoFields({ config, patch, showSsh, setShowSsh }: FieldsProps) {
  const opts = parseOptions(config.options);

  return (
    <>
      <FormRow label="Host">
        <Field value={config.host} onChange={(v) => patch("host", v)} monospace />
      </FormRow>
      <FormRow label="Port">
        <Field value={String(config.port)} onChange={(v) => patch("port", Number(v) || 0)} monospace />
      </FormRow>
      <FormRow label="Catalog">
        <Field
          value={config.database}
          onChange={(v) => patch("database", v)}
          placeholder="memory"
          monospace
        />
      </FormRow>
      <FormRow label="Schema">
        <Field
          value={opts["schema"] ?? ""}
          onChange={(v) => patchOption(config.options, "schema", v, patch)}
          placeholder="default"
          monospace
        />
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
      <CertFields config={config} patch={patch} />
      <SshSection config={config} patch={patch} showSsh={showSsh} setShowSsh={setShowSsh} />
    </>
  );
}

export { TrinoFields };
