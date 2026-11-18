import { ANALYTICS_TOOLS } from "@domains/analytics";
import type { AnalyticsSection, AnalyticsTool } from "@domains/analytics";
import {
  CANVASES_PATH,
  CANVAS_PATH_PREFIX,
  CONNECTIONS_PATH,
  CONNECTION_REQUEST_PATH,
  LINEAGE_SEGMENT,
  MODELS_SEGMENT,
  PATH_SEPARATOR,
  PINNED_PATH,
  RUNS_SEGMENT,
  RUN_PATH_PREFIX,
} from "./constants";
import type { WebRoute } from "./types";

/// The single decoded id segment after `prefix`, or null for nested or malformed paths.
function idSegment(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length);
  if (!segment || segment.includes(PATH_SEPARATOR)) return null;
  return decodeSegment(segment);
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/// `/<tool>[/models|lineage|runs[/<id>]]`, or null when the path is not a tool page.
function analyticsRoute(pathname: string): WebRoute | null {
  const [, toolSegment, section, id, ...rest] = pathname.split(PATH_SEPARATOR);
  const tool = ANALYTICS_TOOLS.find((t) => t === toolSegment);
  if (!tool || rest.length > 0) return null;
  const name = id ? decodeSegment(id) : null;
  if (id && name === null) return null;
  if (!section || section === MODELS_SEGMENT) {
    return name ? { kind: "model", tool, name } : { kind: "models", tool };
  }
  if (section === LINEAGE_SEGMENT) return { kind: "lineage", tool, name };
  if (section === RUNS_SEGMENT) {
    return name ? { kind: "toolRun", tool, runId: name } : { kind: "toolRuns", tool };
  }
  return null;
}

function routeForPath(pathname: string): WebRoute {
  if (pathname === PINNED_PATH) return { kind: "pinned" };
  if (pathname === CONNECTIONS_PATH) return { kind: "connections" };
  if (pathname === CONNECTION_REQUEST_PATH) return { kind: "connectionRequest" };
  if (pathname === CANVASES_PATH) return { kind: "canvases" };
  const runId = idSegment(pathname, RUN_PATH_PREFIX);
  if (runId) return { kind: "run", runId };
  const canvasId = idSegment(pathname, CANVAS_PATH_PREFIX);
  if (canvasId) return { kind: "canvas", canvasId };
  return analyticsRoute(pathname) ?? { kind: "history" };
}

function runPath(runId: string): string {
  return `${RUN_PATH_PREFIX}${encodeURIComponent(runId)}`;
}

function canvasPath(canvasId: string): string {
  return `${CANVAS_PATH_PREFIX}${encodeURIComponent(canvasId)}`;
}

const SECTION_SEGMENTS: Record<AnalyticsSection, string> = {
  models: MODELS_SEGMENT,
  lineage: LINEAGE_SEGMENT,
  runs: RUNS_SEGMENT,
};

/// `/<tool>/<section>[/<id>]`; the id is encoded as one segment.
function analyticsPath(tool: AnalyticsTool, section: AnalyticsSection, id?: string): string {
  const base = `${PATH_SEPARATOR}${tool}${PATH_SEPARATOR}${SECTION_SEGMENTS[section]}`;
  return id ? `${base}${PATH_SEPARATOR}${encodeURIComponent(id)}` : base;
}

export { analyticsPath, canvasPath, routeForPath, runPath };
