import { REQUEST_CLOSED_MESSAGE } from "@domains/connection/components/ConnectionEditorSheet/constants";
import {
  CANCELLED_MESSAGE,
  LOADING_MESSAGE,
  MISSING_REQUEST_MESSAGE,
  REQUEST_QUERY_PARAM,
  SAVED_MESSAGE,
} from "./constants";
import type { ConnectionRequestPageViewModel } from "./types";

function requestIdFromLocation(): string | null {
  return new URLSearchParams(window.location.search).get(REQUEST_QUERY_PARAM);
}

// Status copy for every phase that does not show the form.
function pageMessage(page: ConnectionRequestPageViewModel): string {
  if (!page.requestId) return MISSING_REQUEST_MESSAGE;
  switch (page.phase) {
    case "saved":
      return SAVED_MESSAGE;
    case "cancelled":
      return CANCELLED_MESSAGE;
    case "closed":
      return REQUEST_CLOSED_MESSAGE;
    case "error":
      return page.error ?? REQUEST_CLOSED_MESSAGE;
    default:
      return LOADING_MESSAGE;
  }
}

export { pageMessage, requestIdFromLocation };
