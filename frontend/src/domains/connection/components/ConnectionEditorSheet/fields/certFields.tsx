import { FormRow, PathField } from "@shared/ui";
import type { DialogFilter } from "@shared/ui";
import type { FieldsProps } from "./types";

const CERT_FILTERS: DialogFilter[] = [
  { name: "Certificates", extensions: ["crt", "pem", "cer"] },
  { name: "Keys", extensions: ["key", "pem"] },
  { name: "All files", extensions: ["*"] },
];

// SSL certificate file pickers shared by every SQL driver. Hidden when SSL is
// disabled since the paths are meaningless without TLS. CA cert is needed for
// the verify modes; client cert + key together enable mutual TLS.
export function CertFields({ config, patch }: Pick<FieldsProps, "config" | "patch">) {
  if (config.sslMode === "disabled") return null;
  return (
    <>
      <FormRow label="CA Cert">
        <PathField
          value={config.caCertPath ?? ""}
          onChange={(v) => patch("caCertPath", v)}
          placeholder="ca.crt"
          filters={CERT_FILTERS}
          title="Select CA certificate"
        />
      </FormRow>
      <FormRow label="Client Cert">
        <PathField
          value={config.clientCertPath ?? ""}
          onChange={(v) => patch("clientCertPath", v)}
          placeholder="client.crt"
          filters={CERT_FILTERS}
          title="Select client certificate"
        />
      </FormRow>
      <FormRow label="Client Key">
        <PathField
          value={config.clientKeyPath ?? ""}
          onChange={(v) => patch("clientKeyPath", v)}
          placeholder="client.key"
          filters={CERT_FILTERS}
          title="Select client key"
        />
      </FormRow>
    </>
  );
}
