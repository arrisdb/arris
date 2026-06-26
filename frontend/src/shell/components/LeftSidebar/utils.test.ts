import { describe, expect, it } from "vitest";
import { hasProjectMetadata } from "./utils";

describe("LeftSidebar utils", () => {
  it("detects project metadata from project, root path, or loading state", () => {
    expect(hasProjectMetadata(null, null, false)).toBe(false);
    expect(hasProjectMetadata({ name: "project" }, null, false)).toBe(true);
    expect(hasProjectMetadata(null, "/tmp/project", false)).toBe(true);
    expect(hasProjectMetadata(null, null, true)).toBe(true);
  });
});
