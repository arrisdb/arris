import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";

import type { SqlSchemaDict } from "../sqlSchema";
import { MongoshellCompletionProvider } from "./mongoshell";

const buildMongoshellCompletionSource = (opts: { schema: SqlSchemaDict }) =>
  new MongoshellCompletionProvider(opts).toSource();

// MongoDB schema tree (database → collection) keyed the way buildSqlSchema emits
// it: bare `collection` plus qualified `database.collection`.
const SCHEMA: SqlSchemaDict = {
  customers: [],
  orders: [],
  "appdb.customers": [],
  "appdb.orders": [],
  "logs.events": [],
};

function makeCtx(doc: string, pos?: number, explicit = false): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos ?? doc.length, explicit);
}

function labels(doc: string, explicit = false): string[] {
  const source = buildMongoshellCompletionSource({ schema: SCHEMA });
  const result = source(makeCtx(doc, undefined, explicit));
  return result ? result.options.map((o) => o.label) : [];
}

describe("buildMongoshellCompletionSource", () => {
  it("returns a function", () => {
    expect(typeof buildMongoshellCompletionSource({ schema: {} })).toBe("function");
  });

  it("suppresses the menu on an empty line unless explicitly triggered", () => {
    expect(labels("")).toEqual([]);
    expect(labels("", true)).toContain("db");
  });

  it("offers db keyword, databases, and collections at the start of a statement", () => {
    const got = labels("cust");
    expect(got).toContain("db");
    expect(got).toContain("appdb");
    expect(got).toContain("logs");
    expect(got).toContain("customers");
  });

  it("offers databases and collections after the db keyword", () => {
    const got = labels("db.");
    expect(got).toContain("appdb");
    expect(got).toContain("customers");
    expect(got).not.toContain("db");
  });

  it("offers a database's collections after a database name", () => {
    const got = labels("appdb.");
    expect(got).toContain("customers");
    expect(got).toContain("orders");
    // Collections from a different database are not surfaced under appdb.
    expect(got).not.toContain("events");
  });

  it("offers verbs after a bare collection", () => {
    const got = labels("customers.");
    expect(got).toContain("find");
    expect(got).toContain("insertOne");
    expect(got).toContain("aggregate");
    expect(got).toContain("deleteMany");
  });

  it("offers verbs after database.collection", () => {
    const got = labels("appdb.customers.");
    expect(got).toContain("find");
    expect(got).toContain("updateMany");
  });

  it("offers verbs after the db.collection form", () => {
    expect(labels("db.customers.")).toContain("find");
  });

  it("offers verbs after the db.database.collection form", () => {
    expect(labels("db.appdb.customers.")).toContain("find");
  });

  it("filters verbs by the partial word via the completion `from` anchor", () => {
    const source = buildMongoshellCompletionSource({ schema: SCHEMA });
    const doc = "customers.fi";
    const result = source(makeCtx(doc));
    expect(result).not.toBeNull();
    // `from` points at the start of the partial verb so CodeMirror filters to `fi*`.
    expect(doc.slice(result!.from)).toBe("fi");
    expect(result!.options.map((o) => o.label)).toContain("find");
  });

  it("stays quiet inside the argument JSON", () => {
    const source = buildMongoshellCompletionSource({ schema: SCHEMA });
    expect(source(makeCtx('db.customers.find({ "active": '))).toBeNull();
    expect(source(makeCtx('db.customers.find({ "na'))).toBeNull();
  });

  it("returns null past the deepest namespace level", () => {
    const source = buildMongoshellCompletionSource({ schema: SCHEMA });
    expect(source(makeCtx("a.b.c.d."))).toBeNull();
  });

  it("offers verbs even without a cached schema", () => {
    const source = buildMongoshellCompletionSource({ schema: {} });
    const result = source(makeCtx("widgets."));
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toContain("find");
  });
});
