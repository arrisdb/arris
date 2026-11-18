const API_BASE = "/api";
const EVENTS_PATH = "events";
const PROJECT_HEADER = "x-arris-project";
const PROJECT_QUERY_PARAM = "project";
const PROJECT_STORAGE_KEY = "arris.project";
const JSON_CONTENT_TYPE = "application/json";
const CONTENT_TYPE_HEADER = "content-type";
const POST_METHOD = "POST";
const SAME_ORIGIN = "same-origin";
// Error code for a non-2xx response whose body is not the `{ error }` envelope.
const HTTP_ERROR_CODE = "http_error";
// The desktop app reaches the arris server through its Tauri bridge.
const DESKTOP_API_COMMAND = "cmd_arris_api";
const DESKTOP_SERVER_EVENT = "arris://server-event";
// Sent to subscribers whenever the event stream (re)connects.
const SERVER_CONNECTED_KIND = "server_connected";
const BRIDGE_ERROR_CODE = "server_unavailable";

export {
  API_BASE,
  BRIDGE_ERROR_CODE,
  DESKTOP_API_COMMAND,
  DESKTOP_SERVER_EVENT,
  SERVER_CONNECTED_KIND,
  CONTENT_TYPE_HEADER,
  EVENTS_PATH,
  HTTP_ERROR_CODE,
  JSON_CONTENT_TYPE,
  POST_METHOD,
  PROJECT_HEADER,
  PROJECT_QUERY_PARAM,
  PROJECT_STORAGE_KEY,
  SAME_ORIGIN,
};
