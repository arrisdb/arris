// Autocomplete for the Elasticsearch REST console (`esrest` language), modeled
// on Kibana Dev Tools. Each request is a single line `VERB /path` followed by an
// optional JSON body on subsequent lines.
//
//   - Typing the first token offers HTTP verbs (GET/POST/PUT/DELETE/HEAD).
//   - After a verb, the path completes by segment: the first segment offers the
//     `_`-prefixed cluster/index APIs plus the live index/alias/data-stream names
//     from the cached schema; later segments offer the relevant sub-APIs
//     (`_search`, `_doc`, …) or the `_cat` / `_cluster` namespace children.
//   - JSON body lines (no leading HTTP verb) get no endpoint completion.

import {
  startCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

import { CompletionProvider, type CompletionAnalysis } from "../core/provider";
import type { SqlSchemaDict } from "../sqlSchema";

interface EsRestCompletionOpts {
  schema: SqlSchemaDict;
}

// What the cursor is positioned to complete, decided by `analyze`.
type EsRestSituation =
  | { kind: "method" }
  | { kind: "root"; slashPrefix: string }
  | { kind: "segment"; completed: string[] };

const METHODS = ["GET", "POST", "PUT", "DELETE", "HEAD"];

// Root-level endpoints reachable directly after the verb. Namespaces (`_cat`,
// `_cluster`, `_nodes`) drill into a second level; the rest are terminal.
const ROOT_NAMESPACES = ["_cat", "_cluster", "_nodes"];
const ROOT_TERMINALS = [
  "_search",
  "_aliases",
  "_alias",
  "_mapping",
  "_settings",
  "_sql",
  "_bulk",
  "_analyze",
  "_count",
  "_stats",
  "_reindex",
  "_tasks",
  "_refresh",
  "_template",
  "_index_template",
  "_component_template",
  "_data_stream",
];

// Sub-APIs offered after an index/alias/data-stream name segment.
const INDEX_SUBAPIS = [
  "_search",
  "_doc",
  "_mapping",
  "_settings",
  "_count",
  "_bulk",
  "_analyze",
  "_refresh",
  "_stats",
  "_update_by_query",
  "_delete_by_query",
];

const NAMESPACE_CHILDREN: Record<string, string[]> = {
  _cat: ["indices", "health", "nodes", "aliases", "shards", "count", "segments", "allocation"],
  _cluster: ["health", "state", "stats", "settings", "pending_tasks", "allocation/explain"],
  _nodes: ["stats", "info", "hot_threads"],
};

// Captures the partial path/identifier token at the cursor. ES index patterns
// allow `*`, `,`, `-`, `.` in addition to word chars.
const SEGMENT_RE = /[\w.*,\-]*$/;
const METHOD_VALID_FOR = /^[A-Za-z]*$/;

// Re-fires the menu after inserting `text` so the next path segment is offered.
function applyAndContinue(text: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
    startCompletion(view);
  };
}

function indexNames(schema: SqlSchemaDict): string[] {
  return Object.keys(schema).sort();
}

function methodOptions(): Completion[] {
  return METHODS.map((m) => ({
    label: m,
    type: "keyword",
    detail: "method",
    apply: applyAndContinue(`${m} `),
  }));
}

// Options for the first path segment: namespaces, terminal APIs, index names.
function rootOptions(schema: SqlSchemaDict, slashPrefix: string): Completion[] {
  const namespaces: Completion[] = ROOT_NAMESPACES.map((ns) => ({
    label: ns,
    type: "namespace",
    detail: "API",
    apply: applyAndContinue(`${slashPrefix}${ns}/`),
  }));
  const terminals: Completion[] = ROOT_TERMINALS.map((ep) => ({
    label: ep,
    type: "keyword",
    detail: "endpoint",
    apply: `${slashPrefix}${ep}`,
  }));
  const indices: Completion[] = indexNames(schema).map((name) => ({
    label: name,
    type: "class",
    detail: "index",
    apply: `${slashPrefix}${name}`,
  }));
  return [...indices, ...namespaces, ...terminals];
}

function segmentOptions(completed: string[]): Completion[] {
  const parent = completed[completed.length - 1];
  const children = NAMESPACE_CHILDREN[parent];
  if (children) {
    return children.map((c) => ({ label: c, type: "keyword", detail: parent }));
  }
  // First segment was not a known namespace → treat it as an index/alias name and
  // offer its sub-APIs. Only one level deep; deeper paths get no suggestions.
  if (completed.length === 1) {
    return INDEX_SUBAPIS.map((ep) => ({ label: ep, type: "keyword", detail: "endpoint" }));
  }
  return [];
}

class EsRestCompletionProvider extends CompletionProvider<EsRestSituation> {
  private readonly schema: SqlSchemaDict;

  constructor(opts: EsRestCompletionOpts) {
    super();
    this.schema = opts.schema;
  }

  protected analyze(cc: CompletionContext): CompletionAnalysis<EsRestSituation> | null {
    const lineStart = cc.state.doc.lineAt(cc.pos).from;
    const before = cc.state.sliceDoc(lineStart, cc.pos);

    // Split the line into "<method>< spaces ><rest>". No spaces yet → still typing
    // the method.
    const split = /^(\s*)(\S+)(\s+)(.*)$/.exec(before);

    if (!split) {
      // Method position: offer verbs once the user starts typing one (or asks).
      const partial = before.trim();
      const upper = partial.toUpperCase();
      if (!partial && !cc.explicit) return null;
      if (partial && !METHODS.some((m) => m.startsWith(upper))) return null;
      return {
        from: cc.pos - partial.length,
        situation: { kind: "method" },
        validFor: METHOD_VALID_FOR,
      };
    }

    const method = split[2].toUpperCase();
    // A line whose first token isn't a verb is a JSON body line, no completion.
    if (!METHODS.includes(method)) return null;

    const pathPart = split[4];
    const leadingSlash = pathPart.startsWith("/");
    const body = leadingSlash ? pathPart.slice(1) : pathPart;
    const segs = body.split("/");
    const current = segs[segs.length - 1];
    const completed = segs.slice(0, -1);

    // Only the current (last) segment is being completed.
    const currentPartial = SEGMENT_RE.exec(current)?.[0] ?? "";

    const situation: EsRestSituation =
      completed.length === 0
        // No `/` typed after the verb yet → prefix inserts with the leading slash.
        ? { kind: "root", slashPrefix: leadingSlash ? "" : "/" }
        : { kind: "segment", completed };

    return {
      from: cc.pos - currentPartial.length,
      situation,
      validFor: SEGMENT_RE,
    };
  }

  protected suggest(situation: EsRestSituation): Completion[] {
    switch (situation.kind) {
      case "method":
        return methodOptions();
      case "root":
        return rootOptions(this.schema, situation.slashPrefix);
      case "segment":
        return segmentOptions(situation.completed);
    }
  }
}

export {
  EsRestCompletionProvider,
};

export type {
  EsRestCompletionOpts,
};
