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

export {
  API_BASE,
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
