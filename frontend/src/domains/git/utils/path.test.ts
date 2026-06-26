import { describe, expect, it } from "vitest";
import { pathRelativeToRoot } from "./path";

describe("pathRelativeToRoot", () => {
  it("returns paths relative to the opened project root", () => {
    expect(pathRelativeToRoot("/repo/app/src/a.ts", "/repo/app")).toBe("src/a.ts");
  });

  it("does not trim similar sibling prefixes", () => {
    expect(pathRelativeToRoot("/repo/application/a.ts", "/repo/app")).toBe("/repo/application/a.ts");
  });

  it("handles trailing slashes on the project root", () => {
    expect(pathRelativeToRoot("/repo/app/src/a.ts", "/repo/app/")).toBe("src/a.ts");
  });
});
