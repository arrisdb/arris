import { useConnectionsStore } from "../../hooks";
import { useEffect, useRef, useState } from "react";
import { useProjectStore } from "@shell/hooks/projectStore";
import { fieldComponentForKind } from "./fields/registry";
import {
  deleteConnectionIPC,
  saveConnectionIPC,
  testConnectionIPC,
} from "./ipc";
import type { ConnectionConfig } from "../CombinedConnectionsTree/types";
import type {
  ConnectionEditorSheetProps,
  ConnectionEditorSheetViewModel,
} from "./types";
import {
  buildUri,
  initialConfig,
  initialUri,
  ipcErrorMessage,
  parseUri,
} from "./utils";

function useConnectionEditorSheet({
  open,
  onClose,
  initial,
  kind,
  onSaved,
}: ConnectionEditorSheetProps): ConnectionEditorSheetViewModel {
  const setConnections = useConnectionsStore((state) => state.setConnections);
  const remove = useConnectionsStore((state) => state.removeConnection);
  const activeProjectPath = useProjectStore((state) => state.activeProjectPath);
  const [config, setConfig] = useState<ConnectionConfig>(() => initialConfig(initial, kind));
  const [uri, setUri] = useState(() => initialUri(config));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionEditorSheetViewModel["testResult"]>(null);
  const [showSsh, setShowSsh] = useState(false);
  const uriSyncRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const nextConfig = initialConfig(initial, kind);
    setConfig(nextConfig);
    setUri(buildUri(nextConfig));
    setError(null);
    setTestResult(null);
    setShowSsh(Boolean(nextConfig.sshHost));
  }, [open, initial, kind]);

  useEffect(() => {
    setTestResult(null);
  }, [config]);

  useEffect(() => {
    if (uriSyncRef.current) {
      uriSyncRef.current = false;
      return;
    }
    setUri(buildUri(config));
  }, [config]);

  const patch = <K extends keyof ConnectionConfig>(
    key: K,
    value: ConnectionConfig[K],
  ) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  // Turning the SSH toggle off must strip the ssh* config, not just hide the
  // fields: the backend keys "uses an SSH tunnel" off a non-empty ssh_host
  // (there is no separate enabled flag), so a lingering host would still force a
  // tunnel and fail with "ssh tunnel requires a password or private key".
  const onToggleSsh = (next: boolean) => {
    setShowSsh(next);
    if (!next) {
      setConfig((current) => ({
        ...current,
        sshHost: undefined,
        sshPort: undefined,
        sshUser: undefined,
        sshPassword: undefined,
        sshPrivateKey: undefined,
      }));
    }
  };

  const onChangeUri = (newUri: string) => {
    setUri(newUri);
    const trimmed = newUri.trim();
    if (!trimmed) return;
    try {
      const parsed = parseUri(trimmed);
      uriSyncRef.current = true;
      setConfig((current) => ({ ...current, ...parsed }));
    } catch {
      // Invalid URI: keep text, leave config unchanged.
    }
  };

  const onClickDelete = async () => {
    if (!initial) return;
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      await deleteConnectionIPC(initial.id);
      await remove(initial.id);
      onClose();
    } catch (deleteError) {
      setError(ipcErrorMessage(deleteError));
    } finally {
      setBusy(false);
    }
  };

  // SSH on with no host would silently skip the tunnel (uses_ssh_tunnel keys off
  // a non-empty ssh_host), connecting directly and falsely reporting success.
  const sshHostMissing = showSsh && !(config.sshHost ?? "").trim();

  const onClickSave = async () => {
    if (sshHostMissing) {
      setTestResult(null);
      setError("SSH tunnel requires a host");
      return;
    }
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      // Local connections live inside a project; with no project open there is
      // nowhere to persist them (backend rejects with "no project open"), so
      // fall back to a global, app-wide connection.
      const scope = activeProjectPath ? "local" : "global";
      const connections = await saveConnectionIPC(config, scope);
      setConnections(connections);
      const saved = connections.find((connection) => connection.id === config.id);
      onClose();
      // Always notify the owner of a successful save. Gating on `isConnected`
      // here meant edits to a connection whose live link had dropped silently
      // skipped the schema reload; the owner now decides whether a reload is
      // warranted (e.g. only for connections currently open).
      if (saved) onSaved?.(saved);
    } catch (saveError) {
      setError(ipcErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    // Capture phase + stopImmediatePropagation so the sheet's Mod+Enter never
    // reaches the global keymap (runQuery) firing behind the modal. Swallow the
    // combo even while busy; leaking it through is the bug we're preventing.
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!busy) void onClickSave();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, busy, onClickSave]);

  const onClickTest = async () => {
    if (sshHostMissing) {
      setTestResult({ ok: false, message: "SSH tunnel requires a host" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      await testConnectionIPC(config);
      setTestResult({ ok: true });
    } catch (testError) {
      setTestResult({ ok: false, message: ipcErrorMessage(testError) });
    } finally {
      setTesting(false);
    }
  };

  return {
    busy,
    config,
    error,
    fieldsComponent: fieldComponentForKind(config.kind),
    initial,
    onChangeUri,
    onClickDelete,
    onClickSave,
    onClickTest,
    onClose,
    patch,
    setConfig,
    setShowSsh: onToggleSsh,
    showSsh,
    testResult,
    testing,
    title: initial ? "Edit connection" : "New connection",
    uri,
  };
}

export { useConnectionEditorSheet };
