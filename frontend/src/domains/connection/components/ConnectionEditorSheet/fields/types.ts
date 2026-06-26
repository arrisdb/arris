import type { Dispatch, SetStateAction } from "react";
import type { ConnectionConfig, SslMode } from "../../CombinedConnectionsTree/types";

export interface FieldsProps {
  config: ConnectionConfig;
  patch: <K extends keyof ConnectionConfig>(key: K, value: ConnectionConfig[K]) => void;
  setConfig: Dispatch<SetStateAction<ConnectionConfig>>;
  showSsh: boolean;
  setShowSsh: (v: boolean) => void;
  uri: string;
  onUriChange: (v: string) => void;
}

export const SSL_MODES: SslMode[] = [
  "disabled",
  "preferred",
  "required",
  "verify_ca",
  "verify_identity",
];
