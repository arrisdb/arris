import { describe, it, expect } from "vitest";
import type { FileStatus } from "./types";
import { buildTree, gitChangeFileName, isDirectoryEntry, isStaged } from "./utils";

describe("buildTree", () => {
  it("groups files by directory", () => {
    const statuses: FileStatus[] = [
      { path: "/repo/src/a.ts", status: "M", indexStatus: " ", worktreeStatus: "M" },
      { path: "/repo/src/b.ts", status: "A", indexStatus: "A", worktreeStatus: " " },
      { path: "/repo/README.md", status: "M", indexStatus: " ", worktreeStatus: "M" },
    ];
    const tree = buildTree(statuses, "/repo");
    expect(tree.files).toHaveLength(1);
    expect(tree.files[0].path).toBe("/repo/README.md");
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].name).toBe("src");
    expect(tree.children[0].files).toHaveLength(2);
  });

  it("handles nested directories", () => {
    const statuses: FileStatus[] = [
      { path: "/repo/a/b/c.ts", status: "M", indexStatus: " ", worktreeStatus: "M" },
    ];
    const tree = buildTree(statuses, "/repo");
    expect(tree.children[0].name).toBe("a");
    expect(tree.children[0].children[0].name).toBe("b");
    expect(tree.children[0].children[0].files).toHaveLength(1);
  });

  it("treats an opened subdirectory as the root", () => {
    const statuses: FileStatus[] = [
      { path: "/repo/app/src/a.ts", status: "M", indexStatus: " ", worktreeStatus: "M" },
      { path: "/repo/app/README.md", status: "M", indexStatus: " ", worktreeStatus: "M" },
    ];
    const tree = buildTree(statuses, "/repo/app");
    expect(tree.files[0].path).toBe("/repo/app/README.md");
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].name).toBe("src");
    expect(tree.children[0].path).toBe("/repo/app/src");
  });

  it("returns empty tree for no statuses", () => {
    const tree = buildTree([], "/repo");
    expect(tree.files).toHaveLength(0);
    expect(tree.children).toHaveLength(0);
  });

  it("treats a trailing-slash untracked directory as a single named entry", () => {
    // git porcelain collapses a wholly-untracked dir to one entry ("models/").
    const statuses: FileStatus[] = [
      { path: "/repo/models/", status: "?", indexStatus: "?", worktreeStatus: "?" },
    ];
    const tree = buildTree(statuses, "/repo");
    expect(tree.children).toHaveLength(0);
    expect(tree.files).toHaveLength(1);
    expect(tree.files[0].path).toBe("/repo/models/");
  });
});

describe("gitChangeFileName", () => {
  it("returns the basename of a file path", () => {
    expect(gitChangeFileName("/repo/models/a.sql")).toBe("a.sql");
  });

  it("returns the directory name for a trailing-slash entry", () => {
    expect(gitChangeFileName("/repo/models/")).toBe("models");
  });

  it("falls back to the cleaned path when there is no separator", () => {
    expect(gitChangeFileName("models/")).toBe("models");
  });
});

describe("isDirectoryEntry", () => {
  it("detects a trailing-slash entry as a directory", () => {
    expect(isDirectoryEntry("/repo/models/")).toBe(true);
    expect(isDirectoryEntry("/repo/models/a.sql")).toBe(false);
  });
});

describe("isStaged", () => {
  it("returns true for staged files", () => {
    expect(isStaged({ path: "a", status: "M", indexStatus: "M", worktreeStatus: " " })).toBe(true);
    expect(isStaged({ path: "a", status: "A", indexStatus: "A", worktreeStatus: " " })).toBe(true);
  });

  it("returns false for unstaged files", () => {
    expect(isStaged({ path: "a", status: "M", indexStatus: " ", worktreeStatus: "M" })).toBe(false);
  });

  it("returns false for untracked files", () => {
    expect(isStaged({ path: "a", status: "?", indexStatus: "?", worktreeStatus: "?" })).toBe(false);
  });
});
