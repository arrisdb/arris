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

/// Returns the full connection list either way; the arris server always saves to the
/// project, and `requestId` resolves a pending browser connection request.
async function saveConnectionIPC(
  config: ConnectionConfig,
  scope: "local" | "global" = "local",
  requestId?: string,
): Promise<ScopedConnection[]> {
  if (!isWebShell()) return invoke("cmd_save_connection", { config, scope });
  await apiCall("connection_save", { config, requestId });
  return apiCall("connection_list");
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
