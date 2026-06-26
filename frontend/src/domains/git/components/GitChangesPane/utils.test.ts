import { describe, it, expect } from "vitest";
import { parseMovedRemoteUrl, parseRemoteBranchTarget } from "./utils";

describe("parseMovedRemoteUrl", () => {
  it("extracts the new URL from a GitHub repository-moved push error", () => {
    const message =
      "git push failed: remote: This repository moved. Please use the new location:\n" +
      "remote:   https://github.com/arrisdb/arris.git\n" +
      "To https://github.com/arrisdb/old.git";
    expect(parseMovedRemoteUrl(message)).toBe("https://github.com/arrisdb/arris.git");
  });

  it("handles the single-line 'remote:' inline form", () => {
    const message =
      "This repository moved. Please use the new location: remote: https://github.com/arrisdb/arris.git";
    expect(parseMovedRemoteUrl(message)).toBe("https://github.com/arrisdb/arris.git");
  });

  it("returns null for an unrelated push error", () => {
    expect(parseMovedRemoteUrl("git push failed: no remote configured")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseMovedRemoteUrl(null)).toBeNull();
  });
});

describe("parseRemoteBranchTarget", () => {
  it("parses an explicit 'remote branch' target", () => {
    expect(parseRemoteBranchTarget("upstream develop", "origin", "main")).toEqual({
      remote: "upstream",
      branch: "develop",
    });
  });

  it("falls back to the default branch when only a remote is given", () => {
    expect(parseRemoteBranchTarget("upstream", "origin", "main")).toEqual({
      remote: "upstream",
      branch: "main",
    });
  });

  it("falls back to both defaults when the input is blank", () => {
    expect(parseRemoteBranchTarget("   ", "origin", "main")).toEqual({
      remote: "origin",
      branch: "main",
    });
  });

  it("collapses extra whitespace between tokens", () => {
    expect(parseRemoteBranchTarget("  origin    feature/x  ", "origin", "main")).toEqual({
      remote: "origin",
      branch: "feature/x",
    });
  });
});
