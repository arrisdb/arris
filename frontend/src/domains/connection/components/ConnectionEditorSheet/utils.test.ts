import { describe, it, expect } from "vitest";
import { defaultPortFor, parseUri, buildUri } from "./utils";
import type { ConnectionConfig } from "../CombinedConnectionsTree/types";

describe("connection editor URI utilities", () => {
  it("parses postgres URI with all parts", () => {
    const out = parseUri("postgres://alice:s3cret@db.example.com:6432/inventory?sslmode=require");
    expect(out.kind).toBe("postgres");
    expect(out.host).toBe("db.example.com");
    expect(out.port).toBe(6432);
    expect(out.database).toBe("inventory");
    expect(out.user).toBe("alice");
    expect(out.password).toBe("s3cret");
    expect(out.options).toBe("sslmode=require");
    expect(out.isSRV).toBe(false);
  });

  it("falls back to driver default port when missing", () => {
    const out = parseUri("postgresql://localhost/demo");
    expect(out.port).toBe(5432);
  });

  it("recognises mysql/mariadb/redis schemes", () => {
    expect(parseUri("mysql://h/db").kind).toBe("mysql");
    expect(parseUri("mariadb://h/db").kind).toBe("mariadb");
    expect(parseUri("redis://h").kind).toBe("redis");
  });

  it("flags SRV when scheme is mongodb+srv", () => {
    const out = parseUri("mongodb+srv://u:p@cluster.example/admin");
    expect(out.kind).toBe("mongodb");
    expect(out.isSRV).toBe(true);
  });

  it("URL-decodes user / password", () => {
    const out = parseUri("postgres://us%40er:p%40ss@h/db");
    expect(out.user).toBe("us@er");
    expect(out.password).toBe("p@ss");
  });

  it("defaultPortFor knows the common ports", () => {
    expect(defaultPortFor("postgres")).toBe(5432);
    expect(defaultPortFor("mysql")).toBe(3306);
    expect(defaultPortFor("mongodb")).toBe(27017);
    expect(defaultPortFor("redshift")).toBe(5439);
    expect(defaultPortFor("sqlite")).toBeUndefined();
  });
});

describe("buildUri", () => {
  function makeConfig(overrides: Partial<ConnectionConfig>): ConnectionConfig {
    return {
      id: "test-id",
      name: "test",
      kind: "postgres",
      host: "localhost",
      port: 5432,
      database: "mydb",
      user: "alice",
      password: "secret",
      isSRV: false,
      options: "",
      sslMode: "preferred",
      ...overrides,
    };
  }

  it("builds a basic postgres URI", () => {
    const uri = buildUri(makeConfig({}));
    expect(uri).toBe("postgres://alice:secret@localhost/mydb");
  });

  it("includes port when non-default", () => {
    const uri = buildUri(makeConfig({ port: 6432 }));
    expect(uri).toBe("postgres://alice:secret@localhost:6432/mydb");
  });

  it("omits password when empty", () => {
    const uri = buildUri(makeConfig({ password: "" }));
    expect(uri).toBe("postgres://alice@localhost/mydb");
  });

  it("omits user part entirely when no user", () => {
    const uri = buildUri(makeConfig({ user: "", password: "" }));
    expect(uri).toBe("postgres://localhost/mydb");
  });

  it("encodes special characters in user/password", () => {
    const uri = buildUri(makeConfig({ user: "us@er", password: "p@ss" }));
    expect(uri).toBe("postgres://us%40er:p%40ss@localhost/mydb");
  });

  it("includes options as query string", () => {
    const uri = buildUri(makeConfig({ options: "sslmode=require&timeout=5" }));
    expect(uri).toBe("postgres://alice:secret@localhost/mydb?sslmode=require&timeout=5");
  });

  it("uses mongodb+srv scheme when isSRV", () => {
    const uri = buildUri(makeConfig({ kind: "mongodb", port: 27017, isSRV: true }));
    expect(uri).toBe("mongodb+srv://alice:secret@localhost/mydb");
  });

  it("uses mysql scheme for mysql kind", () => {
    const uri = buildUri(makeConfig({ kind: "mysql", port: 3306 }));
    expect(uri).toBe("mysql://alice:secret@localhost/mydb");
  });

  it("roundtrips through parseUri", () => {
    const config = makeConfig({ port: 6432, options: "sslmode=require" });
    const uri = buildUri(config);
    const parsed = parseUri(uri);
    expect(parsed.kind).toBe("postgres");
    expect(parsed.host).toBe("localhost");
    expect(parsed.port).toBe(6432);
    expect(parsed.database).toBe("mydb");
    expect(parsed.user).toBe("alice");
    expect(parsed.password).toBe("secret");
    expect(parsed.options).toBe("sslmode=require");
  });
});
