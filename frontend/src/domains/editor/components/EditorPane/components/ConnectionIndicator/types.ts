import type { DatabaseKind } from "@shared";

interface EditorConnectionSummary {
  id: string;
  name: string;
  kind: DatabaseKind;
}

interface ConnectionIndicatorProps {
  connectionId: string | null | undefined;
  connections: EditorConnectionSummary[];
  isFederation: boolean;
}

export type {
  ConnectionIndicatorProps,
  DatabaseKind,
  EditorConnectionSummary,
};
