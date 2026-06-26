import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";

import type { SqlSchemaDict } from "../sqlSchema";
import { EsRestCompletionProvider } from "./esRest";

const buildEsRestCompletionSource = (opts: { schema: SqlSchemaDict }) =>
  new EsRestCompletionProvider(opts).toSource();

// ES index/alias/data-stream names as buildSqlSchema emits them: bare keys with
// no columns.
const SCHEMA: SqlSchemaDict = {
  products: [],
  customers: [],
  "logs-2024": [],
};

function makeCtx(doc: string, pos?: number, explicit = false): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos ?? doc.length, explicit);
}

function labels(doc: string, explicit = false): string[] {
  const source = buildEsRestCompletionSource({ schema: SCHEMA });
  const result = source(makeCtx(doc, undefined, explicit));
  return result ? result.options.map((o) => o.label) : [];
}

function fromOf(doc: string): number | null {
  const source = buildEsRestCompletionSource({ schema: SCHEMA });
  const result = source(makeCtx(doc));
  return result ? result.from : null;
}

describe("buildEsRestCompletionSource — method position", () => {
  it("stays silent on a blank line unless explicitly triggered", () => {
    expect(labels("")).toEqual([]);
    expect(labels("", true)).toEqual(["GET", "POST", "PUT", "DELETE", "HEAD"]);
  });

  it("offers verbs while typing the method", () => {
    expect(labels("G")).toContain("GET");
    expect(labels("DEL")).toContain("DELETE");
  });

  it("does not treat a JSON body line as a method", () => {
    // `{` is not a prefix of any HTTP verb.
    expect(labels('{')).toEqual([]);
  });
});

describe("buildEsRestCompletionSource — path position", () => {
  it("surfaces endpoints right after the verb and a space", () => {
    const got = labels("GET ");
    expect(got).toContain("_search");
    expect(got).toContain("_cat");
    expect(got).toContain("products");
    expect(got).toContain("customers");
  });

  it("offers index names and root APIs after the leading slash", () => {
    const got = labels("GET /");
    expect(got).toContain("_search");
    expect(got).toContain("logs-2024");
  });

  it("offers index sub-APIs after an index segment", () => {
    const got = labels("GET /products/");
    expect(got).toContain("_search");
    expect(got).toContain("_doc");
    expect(got).toContain("_mapping");
    // Root-only endpoints are not offered at the sub-API level.
    expect(got).not.toContain("_cat");
  });

  it("drills into the _cat namespace", () => {
    const got = labels("GET /_cat/");
    expect(got).toContain("indices");
    expect(got).toContain("health");
  });

  it("drills into the _cluster namespace", () => {
    const got = labels("GET /_cluster/");
    expect(got).toContain("health");
    expect(got).toContain("state");
  });

  it("anchors `from` to the start of the current segment", () => {
    // `GET /prod` → completing `prod`, so from = 5 (just after the slash).
    expect(fromOf("GET /prod")).toBe(5);
    // `GET /products/_sea` → completing `_sea`, from is just after the 2nd slash.
    expect(fromOf("GET /products/_sea")).toBe("GET /products/".length);
  });

  it("gives no completion inside a JSON body line", () => {
    expect(labels('  "query": ')).toEqual([]);
  });
});
