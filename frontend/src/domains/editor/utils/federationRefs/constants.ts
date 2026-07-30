// Backtick quoting, matching the engine's SQL parser (federation/impl_federation_ref_rewriter.rs).
const QUOTE = "`";
const SEGMENT_SEPARATOR = ".";

// A segment needs no quoting only if it reads as a plain SQL identifier.
const BARE_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A federated ref's leading segment: bare, or backtick-quoted with `` escaping a quote.
const LEADING_SEGMENT_RE = /`(?:[^`]|``)*`|[A-Za-z_][A-Za-z0-9_]*/g;

export {
  BARE_SEGMENT_RE,
  LEADING_SEGMENT_RE,
  QUOTE,
  SEGMENT_SEPARATOR,
};
