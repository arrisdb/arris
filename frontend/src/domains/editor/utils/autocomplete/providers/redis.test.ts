import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";

import type { SqlSchemaDict } from "../sqlSchema";
import {
  RedisCliCompletionProvider,
  RedisSqlCompletionProvider,
} from "./redis";

const buildRedisSqlCompletionSource = (opts: { schema: SqlSchemaDict }) =>
  new RedisSqlCompletionProvider(opts).toSource();
const buildRedisCliCompletionSource = (opts: { schema: SqlSchemaDict }) =>
  new RedisCliCompletionProvider(opts).toSource();

// Redis keyspace keyed the way buildSqlSchema emits it: bare key plus
// `dbN.key` qualified by the owning database container.
const SCHEMA: SqlSchemaDict = {
  "home:key": [],
  "db0.home:key": [],
  "user:1": [],
  "db0.user:1": [],
  "cache:stats": [],
  "db1.cache:stats": [],
};

function makeCtx(doc: string, pos?: number, explicit = false): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos ?? doc.length, explicit);
}

function sqlLabels(doc: string, explicit = false): string[] {
  const source = buildRedisSqlCompletionSource({ schema: SCHEMA });
  const result = source(makeCtx(doc, undefined, explicit));
  return result ? result.options.map((o) => o.label) : [];
}

function cliLabels(doc: string, explicit = false): string[] {
  const source = buildRedisCliCompletionSource({ schema: SCHEMA });
  const result = source(makeCtx(doc, undefined, explicit));
  return result ? result.options.map((o) => o.label) : [];
}

describe("buildRedisSqlCompletionSource", () => {
  it("suppresses the menu on an empty doc unless explicitly triggered", () => {
    expect(sqlLabels("")).toEqual([]);
    expect(sqlLabels("", true)).toContain("SELECT");
  });

  it("offers the SELECT skeleton while typing the verb", () => {
    expect(sqlLabels("SEL")).toContain("SELECT");
  });

  it("offers FROM once SELECT is present but no source yet", () => {
    expect(sqlLabels("SELECT * ")).toContain("FROM");
  });

  it("offers keys, keyspace, db prefixes, and key names in the source position", () => {
    const got = sqlLabels("SELECT * FROM ");
    expect(got).toContain("keys");
    expect(got).toContain("keyspace");
    expect(got).toContain("db0.");
    expect(got).toContain("db1.");
    expect(got).toContain("home:key");
    expect(got).toContain("cache:stats");
  });

  it("narrows to a single database's keys after a dbN. prefix", () => {
    const got = sqlLabels("SELECT * FROM db1.");
    expect(got).toContain("db1.cache:stats");
    // db0-only keys are not surfaced under db1.
    expect(got).not.toContain("db1.home:key");
    expect(got).not.toContain("home:key");
  });

  it("offers WHERE and LIMIT after a source is chosen", () => {
    const got = sqlLabels("SELECT * FROM keys ");
    expect(got).toContain("WHERE");
    expect(got).toContain("LIMIT");
  });

  it("offers the key field after WHERE", () => {
    expect(sqlLabels("SELECT * FROM keys WHERE ")).toContain("key");
  });

  it("offers LIKE after the WHERE field", () => {
    expect(sqlLabels("SELECT * FROM keys WHERE key ")).toContain("LIKE");
  });
});

describe("buildRedisCliCompletionSource", () => {
  it("offers command verbs at the start of a line", () => {
    const got = cliLabels("", true);
    expect(got).toContain("GET");
    expect(got).toContain("HGETALL");
    expect(got).toContain("SELECT");
  });

  it("offers commands while typing the first token", () => {
    expect(cliLabels("HG")).toContain("HGETALL");
  });

  it("offers key names in argument position", () => {
    const got = cliLabels("GET ");
    expect(got).toContain("home:key");
    expect(got).toContain("cache:stats");
    expect(got).not.toContain("GET");
  });

  it("treats each line independently", () => {
    const got = cliLabels("SELECT 1\nHG");
    expect(got).toContain("HGETALL");
  });

  it("stays quiet inside a comment line", () => {
    expect(cliLabels("# note here")).toEqual([]);
  });
});
