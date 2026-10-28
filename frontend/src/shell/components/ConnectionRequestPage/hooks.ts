import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionConfig } from "@domains/connection/components/CombinedConnectionsTree/types";
import { ipcErrorMessage, type DatabaseKind } from "@shared";
import { setCurrentProject } from "@shared/api";
import { CONNECTIONS_PATH, navigate } from "../../utils";
import { PENDING_STATUS } from "./constants";
import {
  cancelConnectionRequestIPC,
  cancelConnectionRequestOnUnloadIPC,
  getConnectionRequestIPC,
} from "./ipc";
import type { ConnectionRequestPageViewModel, RequestPhase } from "./types";

// Loads the request and pins its project so later calls carry the right header.
function useLoadRequest(
  requestId: string | null,
  setPhase: (phase: RequestPhase) => void,
  setKind: (kind: DatabaseKind | null) => void,
  setPrefill: (prefill: ConnectionConfig | null) => void,
  setError: (error: string) => void,
): void {
  useEffect(() => {
    if (!requestId) return;
    let live = true;
    getConnectionRequestIPC(requestId)
      .then((request) => {
        if (!live) return;
        setCurrentProject(request.project);
        setKind(request.kind);
        setPrefill(request.prefill?.fields ?? null);
        setPhase(request.status.status === PENDING_STATUS ? "pending" : "closed");
      })
      .catch((loadError) => {
        if (!live) return;
        setError(ipcErrorMessage(loadError));
        setPhase("error");
      });
    return () => {
      live = false;
    };
  }, [requestId, setPhase, setKind, setPrefill, setError]);
}

function useCancelOnUnload(requestId: string | null, phase: RequestPhase): void {
  useEffect(() => {
    if (!requestId || phase !== "pending") return;
    const onBeforeUnload = () => cancelConnectionRequestOnUnloadIPC(requestId);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [requestId, phase]);
}

function useConnectionRequest(requestId: string | null): ConnectionRequestPageViewModel {
  const [phase, setPhase] = useState<RequestPhase>("loading");
  const [kind, setKind] = useState<DatabaseKind | null>(null);
  const [prefill, setPrefill] = useState<ConnectionConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The editor closes itself after a save; that close must not cancel the request.
  const savedRef = useRef(false);

  useLoadRequest(requestId, setPhase, setKind, setPrefill, setError);
  useCancelOnUnload(requestId, phase);

  // The terminal command has its answer; show the new connection instead of a dead end.
  const onSaved = useCallback(() => {
    savedRef.current = true;
    navigate(CONNECTIONS_PATH);
  }, []);

  const onClose = useCallback(() => {
    if (savedRef.current || !requestId) return;
    setPhase("cancelled");
    cancelConnectionRequestIPC(requestId).catch(() => {});
  }, [requestId]);

  return { phase, requestId, kind, prefill, error, onSelectKind: setKind, onSaved, onClose };
}

export { useConnectionRequest };
