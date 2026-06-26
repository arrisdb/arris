import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionConfig,
  ScopedConnection,
} from "../CombinedConnectionsTree/types";

function deleteConnectionIPC(id: string): Promise<void> {
  return invoke("cmd_delete_connection", { id });
}

function saveConnectionIPC(
  config: ConnectionConfig,
  scope: "local" | "global" = "local",
): Promise<ScopedConnection[]> {
  return invoke("cmd_save_connection", { config, scope });
}

function testConnectionIPC(config: ConnectionConfig): Promise<void> {
  return invoke("cmd_test_connection", { config });
}

export {
  deleteConnectionIPC,
  saveConnectionIPC,
  testConnectionIPC,
};
