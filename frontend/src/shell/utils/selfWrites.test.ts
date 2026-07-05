import { beforeEach, describe, expect, it } from "vitest";
import { clearSelfWrites, isSelfWrite, recordSelfWrite } from "./selfWrites";

describe("selfWrites registry", () => {
  beforeEach(() => clearSelfWrites());

  it("recognizes disk content that matches the app's last write", () => {
    recordSelfWrite("/repo/a.sql", "SELECT 1;");
    expect(isSelfWrite("/repo/a.sql", "SELECT 1;")).toBe(true);
  });

  it("treats content that differs from the last write as external", () => {
    recordSelfWrite("/repo/a.sql", "SELECT 1;");
    expect(isSelfWrite("/repo/a.sql", "SELECT 2;")).toBe(false);
  });

  it("only compares against the most recent write per path", () => {
    recordSelfWrite("/repo/a.sql", "v1");
    recordSelfWrite("/repo/a.sql", "v2");
    expect(isSelfWrite("/repo/a.sql", "v1")).toBe(false);
    expect(isSelfWrite("/repo/a.sql", "v2")).toBe(true);
  });

  it("keys writes by path", () => {
    recordSelfWrite("/repo/a.sql", "A");
    expect(isSelfWrite("/repo/b.sql", "A")).toBe(false);
  });

  it("reports no self-write for an unknown path", () => {
    expect(isSelfWrite("/repo/never.sql", "anything")).toBe(false);
  });
});
