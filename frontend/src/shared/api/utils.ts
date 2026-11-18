import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
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

async function desktopApiCall<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(DESKTOP_API_COMMAND, { project: currentProject(), cmd, args });
  } catch (e) {
    if (isErrorBody(e)) throw new ApiError(e.error.code, e.error.message, 0);
    throw new ApiError(BRIDGE_ERROR_CODE, String(e), 0);
  }
}

async function apiCall<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!webShell) return desktopApiCall<T>(cmd, args);
  const response = await fetch(`${API_BASE}/${cmd}`, requestInit(args));
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

// Fire-and-forget POST that survives page unload; unlike sendBeacon it can carry the project header.
function apiBeacon(cmd: string, args: Record<string, unknown> = {}): void {
  void fetch(`${API_BASE}/${cmd}`, { ...requestInit(args), keepalive: true }).catch(() => {});
}

// One stream shared by all subscribers: an EventSource in the browser, the Tauri bridge on desktop.
let closeSource: (() => void) | null = null;
const handlers = new Set<(event: ServerEvent) => void>();
const CONNECTED: ServerEvent = { kind: SERVER_CONNECTED_KIND, project: null, payload: null };

function dispatch(event: ServerEvent): void {
  handlers.forEach((h) => h(event));
}

function openSource(): () => void {
  if (!webShell) {
    const unlisten = listen<ServerEvent>(DESKTOP_SERVER_EVENT, (e) => dispatch(e.payload));
    return () => void unlisten.then((stop) => stop()).catch(() => {});
  }
  // The project lets the server know a page shows it, so the CLI opens no second one.
  const query = new URLSearchParams({ [PROJECT_QUERY_PARAM]: currentProject() ?? "" });
  const source = new EventSource(`${API_BASE}/${EVENTS_PATH}?${query}`);
  source.onopen = () => dispatch(CONNECTED);
  source.onmessage = (message) => dispatch(JSON.parse(message.data) as ServerEvent);
  return () => source.close();
}

function subscribe(handler: (event: ServerEvent) => void): () => void {
  closeSource ??= openSource();
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      closeSource?.();
      closeSource = null;
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
