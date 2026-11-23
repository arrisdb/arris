import { apiBeacon, apiCall } from "@shared/api";
import type { ConnectionRequest } from "./types";

function getConnectionRequestIPC(id: string): Promise<ConnectionRequest> {
  return apiCall("connection_request_get", { id });
}

function cancelConnectionRequestIPC(id: string): Promise<void> {
  return apiCall("connection_request_cancel", { id });
}

// Survives the page unloading, so closing the tab still releases the waiting CLI.
function cancelConnectionRequestOnUnloadIPC(id: string): void {
  apiBeacon("connection_request_cancel", { id });
}

export { cancelConnectionRequestIPC, cancelConnectionRequestOnUnloadIPC, getConnectionRequestIPC };
