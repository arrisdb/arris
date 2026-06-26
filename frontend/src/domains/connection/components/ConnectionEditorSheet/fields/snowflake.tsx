import { Field, FormRow } from "@shared/ui";
import { SshSection } from "./sshSection";
import type { FieldsProps } from "./types";

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

function SnowflakeFields({ config, patch, showSsh, setShowSsh }: FieldsProps) {
  const opts = parseOptions(config.options);

  return (
    <>
      <FormRow label="Account">
        <Field
          value={config.host}
          onChange={(v) => patch("host", v)}
          placeholder="xy12345.us-east-1"
          monospace
        />
      </FormRow>
      <FormRow label="Warehouse">
        <Field
          value={opts["warehouse"] ?? ""}
          onChange={(v) => patchOption(config.options, "warehouse", v, patch)}
          placeholder="COMPUTE_WH"
          monospace
        />
      </FormRow>
      <FormRow label="Database">
        <Field
          value={config.database}
          onChange={(v) => patch("database", v)}
          monospace
        />
      </FormRow>
      <FormRow label="Schema">
        <Field
          value={opts["schema"] ?? ""}
          onChange={(v) => patchOption(config.options, "schema", v, patch)}
          placeholder="PUBLIC"
          monospace
        />
      </FormRow>
      <FormRow label="Role">
        <Field
          value={opts["role"] ?? ""}
          onChange={(v) => patchOption(config.options, "role", v, patch)}
          placeholder="SYSADMIN"
          monospace
        />
      </FormRow>
      <FormRow label="User">
        <Field
          value={config.user}
          onChange={(v) => patch("user", v)}
          monospace
        />
      </FormRow>
      <FormRow label="Password">
        <Field
          type="password"
          value={config.password}
          onChange={(v) => patch("password", v)}
          monospace
        />
      </FormRow>
      <SshSection config={config} patch={patch} showSsh={showSsh} setShowSsh={setShowSsh} />
    </>
  );
}

export { SnowflakeFields };
