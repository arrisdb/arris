import {
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
} from "./constants";
import type { ApiErrorBody, ServerEvent } from "./types";

// Set once at startup when this bundle runs as the arris server's web UI.
let webShell = false;

/// Route IPC over the arris server's HTTP API instead of Tauri.
function enableWebShell(): void {
  webShell = true;
}

/// True in the browser web UI; the desktop app (and tests) use Tauri IPC.
function isWebShell(): boolean {
  return webShell;
}

// Project pinned by the page itself (e.g. taken from a connection request).
let pinnedProject: string | null = null;

class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function readStoredProject(): string | null {
  try {
    return window.localStorage.getItem(PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function requestInit(args: Record<string, unknown>): RequestInit & { headers: Record<string, string> } {
  const headers: Record<string, string> = { [CONTENT_TYPE_HEADER]: JSON_CONTENT_TYPE };
  const project = currentProject();
  if (project) headers[PROJECT_HEADER] = project;
  return { method: POST_METHOD, credentials: SAME_ORIGIN, headers, body: JSON.stringify(args) };
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  const error = (value as ApiErrorBody | null)?.error;
  return typeof error?.code === "string" && typeof error?.message === "string";
}

async function toApiError(response: Response): Promise<ApiError> {
  const text = await response.text();
  try {
    const body: unknown = JSON.parse(text);
    if (isErrorBody(body)) return new ApiError(body.error.code, body.error.message, response.status);
  } catch {
    // Not the JSON error envelope; fall through to the raw text.
  }
  return new ApiError(HTTP_ERROR_CODE, text || response.statusText, response.status);
}

function currentProject(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get(PROJECT_QUERY_PARAM);
  return fromQuery || pinnedProject || readStoredProject();
}

function setCurrentProject(project: string | null): void {
  pinnedProject = project;
  if (!project) return;
  try {
    window.localStorage.setItem(PROJECT_STORAGE_KEY, project);
  } catch {
    // Storage unavailable; the in-memory pin still applies for this page.
  }
}

async function apiCall<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${API_BASE}/${cmd}`, requestInit(args));
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

// Fire-and-forget POST that survives page unload; unlike sendBeacon it can carry the project header.
function apiBeacon(cmd: string, args: Record<string, unknown> = {}): void {
  void fetch(`${API_BASE}/${cmd}`, { ...requestInit(args), keepalive: true }).catch(() => {});
}

// One EventSource shared by all subscribers to stay under the browser per-origin connection limit.
let sharedSource: EventSource | null = null;
const handlers = new Set<(event: ServerEvent) => void>();

function subscribe(handler: (event: ServerEvent) => void): () => void {
  if (!sharedSource) {
    sharedSource = new EventSource(`${API_BASE}/${EVENTS_PATH}`);
    sharedSource.onmessage = (message) => {
      const event = JSON.parse(message.data) as ServerEvent;
      handlers.forEach((h) => h(event));
    };
  }
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      sharedSource?.close();
      sharedSource = null;
    }
  };
}

export {
  ApiError,
  apiBeacon,
  apiCall,
  currentProject,
  enableWebShell,
  isWebShell,
  setCurrentProject,
  subscribe,
};
