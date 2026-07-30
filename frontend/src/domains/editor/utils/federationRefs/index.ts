import { BARE_SEGMENT_RE, QUOTE, SEGMENT_SEPARATOR } from "./constants";

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

// Splits on dots outside backticks, keeping each segment exactly as written, so a
// quoted name holding a dot stays one segment.
function splitFederationRef(ref: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < ref.length; i++) {
    const ch = ref[i];
    if (ch === QUOTE) {
      if (quoted && ref[i + 1] === QUOTE) {
        current += QUOTE + QUOTE;
        i++;
        continue;
      }
      quoted = !quoted;
      current += ch;
      continue;
    }
    if (ch === SEGMENT_SEPARATOR && !quoted) {
      segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

function federationRefKey(segments: string[]): string {
  return segments.map(quoteFederationSegment).join(SEGMENT_SEPARATOR);
}

export {
  federationRefKey,
  isQuotedSegment,
  quoteFederationSegment,
  splitFederationRef,
  unquoteFederationSegment,
};
