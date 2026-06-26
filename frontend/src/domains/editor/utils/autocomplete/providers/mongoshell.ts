// Autocomplete for the native Mongo shell (`mongoshell`) console. Mirrors the
// Rust parser's accepted shapes (drivers/mongodb/parser.rs):
//   db.<collection>.<verb>(...)        bare <collection>.<verb>(...)
//   <database>.<collection>.<verb>(...)  db.<database>.<collection>.<verb>(...)
//
// Suggestions follow the cursor's position in the dotted namespace path: the
// `db` keyword and database / collection names at the namespace level, then the
// verb set once a collection is resolved. Inside the `(...)` argument JSON we
// stay quiet: that is free-form BSON, not a namespace.

import {
  snippetCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

import { CompletionProvider, type CompletionAnalysis } from "../core/provider";
import type { SqlSchemaDict } from "../sqlSchema";

interface MongoshellCompletionOpts {
  schema: SqlSchemaDict;
}

interface MongoNamespace {
  databases: string[];
  collectionsByDb: Map<string, string[]>;
  allCollections: string[];
}

// The resolved namespace segments before the partial word: what `analyze`
// hands to `suggest`.
interface MongoSituation {
  completed: string[];
}

// `[label, snippet template]`. The snippet's `${}` marks where the caret lands
// after the verb is inserted, so the user is dropped straight into the argument.
const VERB_SNIPPETS: readonly [string, string][] = [
  ["find", "find(${})"],
  ["findOne", "findOne(${})"],
  ["aggregate", "aggregate([${}])"],
  ["countDocuments", "countDocuments(${})"],
  ["estimatedDocumentCount", "estimatedDocumentCount()"],
  ["insertOne", "insertOne(${})"],
  ["insertMany", "insertMany([${}])"],
  ["updateOne", "updateOne(${filter}, ${update})"],
  ["updateMany", "updateMany(${filter}, ${update})"],
  ["deleteOne", "deleteOne(${})"],
  ["deleteMany", "deleteMany(${})"],
];

const CHAIN_RE = /(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$]*$/;
const MONGO_VALID_FOR = /^[\w$]*$/;

// The mongodb schema tree is database → collection, so `buildSqlSchema` keys it
// as bare `collection` plus qualified `database.collection`. Split both back out.
function parseNamespace(schema: SqlSchemaDict): MongoNamespace {
  const databases = new Set<string>();
  const collectionsByDb = new Map<string, string[]>();
  const allCollections = new Set<string>();
  for (const key of Object.keys(schema)) {
    const parts = key.split(".");
    const collection = parts[parts.length - 1];
    allCollections.add(collection);
    if (parts.length < 2) continue;
    const database = parts.slice(0, -1).join(".");
    databases.add(database);
    const list = collectionsByDb.get(database) ?? [];
    if (!list.includes(collection)) list.push(collection);
    collectionsByDb.set(database, list);
  }
  return {
    databases: [...databases],
    collectionsByDb,
    allCollections: [...allCollections],
  };
}

// Net parenthesis depth of `text`, ignoring parens inside single/double-quoted
// strings. A depth > 0 means the cursor sits inside an unclosed argument list.
function parenDepth(text: string): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (const ch of text) {
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
  }
  return depth;
}

// Re-fires the completion menu after inserting a `name.`, so the next namespace
// level (collections, then verbs) is offered without a manual keystroke.
function applyWithDot(name: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const insert = `${name}.`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    });
    startCompletion(view);
  };
}

function dbKeywordOption(): Completion {
  return { label: "db", type: "keyword", boost: 2, apply: applyWithDot("db") };
}

function databaseOptions(databases: string[]): Completion[] {
  return databases.map((name) => ({
    label: name,
    type: "schema",
    detail: "database",
    boost: 1,
    apply: applyWithDot(name),
  }));
}

function collectionOptions(collections: string[]): Completion[] {
  return collections.map((name) => ({
    label: name,
    type: "table",
    detail: "collection",
    apply: applyWithDot(name),
  }));
}

function verbOptions(): Completion[] {
  return VERB_SNIPPETS.map(([label, template]) =>
    snippetCompletion(template, { label, type: "function", detail: "verb" }),
  );
}

// Resolved namespace segments before the partial word decide what to offer:
//   []                → start: db keyword + databases + collections
//   ["db"]            → after `db.`: databases + collections
//   [database]        → that database's collections
//   [collection]      → verbs
//   [database, coll]  → verbs
function optionsForPath(completed: string[], ns: MongoNamespace): Completion[] {
  if (completed.length === 0) {
    return [
      dbKeywordOption(),
      ...databaseOptions(ns.databases),
      ...collectionOptions(ns.allCollections),
    ];
  }
  const path = completed[0] === "db" ? completed.slice(1) : completed;
  if (path.length === 0) {
    return [...databaseOptions(ns.databases), ...collectionOptions(ns.allCollections)];
  }
  if (path.length === 1) {
    const name = path[0];
    if (ns.databases.includes(name)) {
      return collectionOptions(ns.collectionsByDb.get(name) ?? []);
    }
    return verbOptions();
  }
  if (path.length === 2) return verbOptions();
  return [];
}

class MongoshellCompletionProvider extends CompletionProvider<MongoSituation> {
  private readonly ns: MongoNamespace;

  constructor(opts: MongoshellCompletionOpts) {
    super();
    this.ns = parseNamespace(opts.schema);
  }

  protected analyze(cc: CompletionContext): CompletionAnalysis<MongoSituation> | null {
    const before = cc.state.sliceDoc(0, cc.pos);
    // Inside the argument JSON (`find({ ... `): not a namespace, stay quiet.
    if (parenDepth(before) > 0) return null;

    const match = CHAIN_RE.exec(before);
    const chain = match ? match[0] : "";
    const segments = chain.split(".");
    const partial = segments[segments.length - 1];
    const completed = segments.slice(0, -1);

    // Empty doc / fresh line with nothing typed: don't pop the menu unasked.
    if (!partial && completed.length === 0 && !cc.explicit) return null;

    return {
      from: cc.pos - partial.length,
      situation: { completed },
      validFor: MONGO_VALID_FOR,
    };
  }

  protected suggest(situation: MongoSituation): Completion[] {
    return optionsForPath(situation.completed, this.ns);
  }
}

export {
  MongoshellCompletionProvider,
};

export type {
  MongoshellCompletionOpts,
};
