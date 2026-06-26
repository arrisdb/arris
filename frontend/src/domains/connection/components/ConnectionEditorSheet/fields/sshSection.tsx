import type { FieldsProps } from "./types";
import { Field, FormRow, PathField, Toggle } from "@shared/ui";

type Props = Pick<FieldsProps, "config" | "patch" | "showSsh" | "setShowSsh">;

export function SshSection({ config, patch, showSsh, setShowSsh }: Props) {
  return (
    <>
      <FormRow label="SSH Tunnel">
        <Toggle checked={showSsh} onChange={setShowSsh} ariaLabel="SSH Tunnel" />
      </FormRow>
      {showSsh && (
        <>
          <FormRow label="SSH Host">
            <Field
              value={config.sshHost ?? ""}
              onChange={(v) => patch("sshHost", v || undefined)}
              monospace
              placeholder="bastion.example.com"
            />
          </FormRow>
          <FormRow label="SSH Port">
            <Field
              value={String(config.sshPort ?? 22)}
              onChange={(v) => patch("sshPort", Number(v) || 22)}
              monospace
            />
          </FormRow>
          <FormRow label="SSH User">
            <Field
              value={config.sshUser ?? ""}
              onChange={(v) => patch("sshUser", v || undefined)}
              monospace
            />
          </FormRow>
          <FormRow label="SSH Password">
            <Field
              type="password"
              value={config.sshPassword ?? ""}
              onChange={(v) => patch("sshPassword", v || undefined)}
              monospace
            />
          </FormRow>
          <FormRow label="Private Key">
            <PathField
              value={config.sshPrivateKey ?? ""}
              onChange={(v) => patch("sshPrivateKey", v || undefined)}
              placeholder="~/.ssh/id_rsa"
              title="Select SSH private key"
              testId="ssh-private-key-browse"
            />
          </FormRow>
        </>
      )}
    </>
  );
}
