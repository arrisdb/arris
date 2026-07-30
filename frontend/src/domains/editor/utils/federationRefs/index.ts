import { BARE_SEGMENT_RE, QUOTE, SEGMENT_SEPARATOR, SEGMENT_TOKEN_RE } from "./constants";
import type { FederationSegment } from "./types";

// Backticks a segment the SQL parser would otherwise choke on, doubling any it holds.
function quoteFederationSegment(name: string): string {
  if (BARE_SEGMENT_RE.test(name)) return name;
  return QUOTE + name.split(QUOTE).join(QUOTE + QUOTE) + QUOTE;
}

function isQuotedSegment(segment: string): boolean {
  return segment.length >= 2 && segment.startsWith(QUOTE) && segment.endsWith(QUOTE);
}

function unquoteFederationSegment(segment: string): string {
  if (!isQuotedSegment(segment)) return segment;
  return segment.slice(1, -1).split(QUOTE + QUOTE).join(QUOTE);
}

// Segments as written, quotes kept, so a quoted name holding a dot stays one segment.
function splitFederationRef(ref: string): string[] {
  return [...ref.matchAll(SEGMENT_TOKEN_RE)].map((m) => m[0]);
}

// Every segment in free text, with its range. `matchAll` clones the regex, so the
// shared `lastIndex` never leaks between callers.
function findFederationSegments(text: string): FederationSegment[] {
  return [...text.matchAll(SEGMENT_TOKEN_RE)].map((m) => ({
    value: m[0],
    from: m.index,
    to: m.index + m[0].length,
  }));
}

function federationRefKey(segments: string[]): string {
  return segments.map(quoteFederationSegment).join(SEGMENT_SEPARATOR);
}

export {
  federationRefKey,
  findFederationSegments,
  isQuotedSegment,
  quoteFederationSegment,
  splitFederationRef,
  unquoteFederationSegment,
};

export type {
  FederationSegment,
};
