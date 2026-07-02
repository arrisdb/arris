// Memoized `Text -> string` conversion. Several per-keystroke consumers
// (statement highlight, autocomplete clause detection, param hints) each called
// `state.doc.toString()` on the same document version, allocating a full copy
// of the document apiece on every keystroke. `Text` is immutable, so one copy
// per document version is enough; the WeakMap lets old versions be collected.

import type { Text } from "@codemirror/state";

const cache = new WeakMap<Text, string>();

function docString(doc: Text): string {
  let s = cache.get(doc);
  if (s === undefined) {
    s = doc.toString();
    cache.set(doc, s);
  }
  return s;
}

export { docString };
