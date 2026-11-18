import { invoke } from "@tauri-apps/api/core";
import { apiCall, isWebShell } from "@shared/api";
import type {
  ConnectionConfig,
  ScopedConnection,
} from "../CombinedConnectionsTree/types";

function deleteConnectionIPC(id: string): Promise<void> {
  if (isWebShell()) return apiCall("connection_remove", { connection: id });
  return invoke("cmd_delete_connection", { id });
}

/// The saved connection (the arris server may assign a new id) and the full list.
/// The server always saves to the project; `requestId` settles a browser request.
async function saveConnectionIPC(
  config: ConnectionConfig,
  scope: "local" | "global" = "local",
  requestId?: string,
): Promise<{ saved: ScopedConnection | undefined; connections: ScopedConnection[] }> {
  if (!isWebShell()) {
    const connections: ScopedConnection[] = await invoke("cmd_save_connection", { config, scope });
    return { saved: connections.find((c) => c.id === config.id), connections };
  }
  const saved: ScopedConnection = await apiCall("connection_save", { config, requestId });
  return { saved, connections: await apiCall("connection_list") };
}

function testConnectionIPC(config: ConnectionConfig): Promise<void> {
  if (isWebShell()) return apiCall("connection_test", { config });
  return invoke("cmd_test_connection", { config });
}

export {
  deleteConnectionIPC,
  saveConnectionIPC,
  testConnectionIPC,
};
