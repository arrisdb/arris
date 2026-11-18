import type { ConnectionConfig } from "@domains/connection/components/CombinedConnectionsTree/types";
import type { DatabaseKind } from "@shared";

type ConnectionRequestStatus =
  | { status: "pending" }
  | { status: "saved"; connectionId: string; name: string }
  | { status: "cancelled" };

/// Non-secret fields from a dbt profile or sqlmesh gateway.
interface ConnectionPrefill {
  name: string;
  kind: DatabaseKind;
  fields: ConnectionConfig;
}

/// Browser connection request as returned by `connection_request_get`.
interface ConnectionRequest {
  id: string;
  project: string;
  kind: DatabaseKind | null;
  prefill: ConnectionPrefill | null;
  /// The saved connection `arris connection edit` opened, secrets scrubbed.
  editing: ConnectionConfig | null;
  status: ConnectionRequestStatus;
}

/// `closed` is a request that was already settled when the page loaded.
type RequestPhase = "loading" | "pending" | "cancelled" | "closed" | "error";

interface ConnectionRequestPageViewModel {
  phase: RequestPhase;
  requestId: string | null;
  kind: DatabaseKind | null;
  prefill: ConnectionConfig | null;
  /// Set when editing a saved connection; the form saves over it.
  initial: ConnectionConfig | null;
  error: string | null;
  onSelectKind: (kind: DatabaseKind) => void;
  onSaved: () => void;
  onClose: () => void;
}

export type { ConnectionPrefill, ConnectionRequest, ConnectionRequestPageViewModel, ConnectionRequestStatus, RequestPhase };
