import { useSyncExternalStore } from "react";
import { DIR_QUERY_PARAM } from "@domains/analytics";
import { PROJECT_QUERY_PARAM } from "@shared/api";
import { POPSTATE_EVENT } from "./constants";
import { routeForPath } from "./routes";
import type { WebRoute } from "./types";

const listeners = new Set<() => void>();

// Params that scope every page, so navigating keeps the same project and subfolder.
const STICKY_QUERY_PARAMS = [PROJECT_QUERY_PARAM, DIR_QUERY_PARAM];

// Pushes a path, carrying over the sticky query params so the scope survives navigation.
function navigate(path: string): void {
  const current = new URLSearchParams(window.location.search);
  const kept = new URLSearchParams();
  for (const key of STICKY_QUERY_PARAMS) {
    const value = current.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.size > 0 ? `?${kept}` : "";
  window.history.pushState(null, "", `${path}${query}`);
  listeners.forEach((notify) => notify());
}

function subscribePath(notify: () => void): () => void {
  listeners.add(notify);
  window.addEventListener(POPSTATE_EVENT, notify);
  return () => {
    listeners.delete(notify);
    window.removeEventListener(POPSTATE_EVENT, notify);
  };
}

function pathSnapshot(): string {
  return window.location.pathname;
}

function useRoute(): WebRoute {
  return routeForPath(useSyncExternalStore(subscribePath, pathSnapshot));
}

export { navigate, useRoute };
