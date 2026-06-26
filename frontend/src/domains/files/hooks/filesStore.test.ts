import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import type { FileTreeEntry } from "@domains/files/components/FileTreeView/types";
import { useFilesStore } from "./filesStore";
import { useRecentsStore } from "@shell/hooks/recentsStore";
import { findProjectRoot } from "@domains/files/components/FileTreeView/utils";

const sampleTree: FileTreeEntry = {
  name: "jaffle_shop",
  path: "/tmp/jaffle_shop",
  isDir: true,
  children: [
    {
      name: "models",
      path: "/tmp/jaffle_shop/models",
      isDir: true,
      children: [
        {
          name: "marts",
          path: "/tmp/jaffle_shop/models/marts",
          isDir: true,
          children: [
            {
              name: "dim_users.sql",
              path: "/tmp/jaffle_shop/models/marts/dim_users.sql",
              isDir: false,
              children: [],
            },
          ],
        },
      ],
    },
    {
      name: "dbt_project.yml",
      path: "/tmp/jaffle_shop/dbt_project.yml",
      isDir: false,
      children: [],
    },
  ],
};

describe("filesStore", () => {
  beforeEach(() => {
    useFilesStore.getState().clear();
    useRecentsStore.setState({ recents: [] });
    localStorage.clear();
    mockInvoke.mockReset();
  });

  it("loadFromPath stores tree and auto-expands well-known dirs", async () => {
    mockInvoke.mockResolvedValue(sampleTree);
    await useFilesStore.getState().loadFromPath("/tmp/jaffle_shop");
    const s = useFilesStore.getState();
    expect(s.rootPath).toBe("/tmp/jaffle_shop");
    expect(s.tree).toEqual(sampleTree);
    expect(s.expanded.has("/tmp/jaffle_shop")).toBe(true);
    expect(s.expanded.has("/tmp/jaffle_shop/models")).toBe(true);
  });

  it("loadFromPath records errors", async () => {
    mockInvoke.mockRejectedValue(new Error("denied"));
    await useFilesStore.getState().loadFromPath("/nope");
    const s = useFilesStore.getState();
    expect(s.tree).toBeNull();
    expect(s.loadError).toContain("denied");
  });

  it("toggleExpanded flips path membership", () => {
    const s = useFilesStore.getState();
    s.setTree("/tmp/jaffle_shop", sampleTree);
    s.toggleExpanded("/tmp/jaffle_shop/models/marts");
    expect(useFilesStore.getState().expanded.has("/tmp/jaffle_shop/models/marts")).toBe(true);
    s.toggleExpanded("/tmp/jaffle_shop/models/marts");
    expect(useFilesStore.getState().expanded.has("/tmp/jaffle_shop/models/marts")).toBe(false);
  });

  it("setClipboard and clearClipboard manage clipboard state", () => {
    const s = useFilesStore.getState();
    s.setClipboard("/tmp/jaffle_shop/dbt_project.yml", "copy");
    expect(useFilesStore.getState().clipboardPath).toBe("/tmp/jaffle_shop/dbt_project.yml");
    expect(useFilesStore.getState().clipboardOp).toBe("copy");
    s.setClipboard("/tmp/jaffle_shop/models", "cut");
    expect(useFilesStore.getState().clipboardOp).toBe("cut");
    s.clearClipboard();
    expect(useFilesStore.getState().clipboardPath).toBeNull();
    expect(useFilesStore.getState().clipboardOp).toBeNull();
  });

  it("setRenamingPath tracks renaming state", () => {
    const s = useFilesStore.getState();
    s.setRenamingPath("/tmp/jaffle_shop/dbt_project.yml");
    expect(useFilesStore.getState().renamingPath).toBe("/tmp/jaffle_shop/dbt_project.yml");
    s.setRenamingPath(null);
    expect(useFilesStore.getState().renamingPath).toBeNull();
  });

  it("refresh reloads tree preserving expanded state", async () => {
    mockInvoke.mockResolvedValue(sampleTree);
    await useFilesStore.getState().loadFromPath("/tmp/jaffle_shop");
    useFilesStore.getState().toggleExpanded("/tmp/jaffle_shop/models/marts");
    const expandedBefore = new Set(useFilesStore.getState().expanded);
    mockInvoke.mockResolvedValue(sampleTree);
    await useFilesStore.getState().refresh();
    const expandedAfter = useFilesStore.getState().expanded;
    for (const p of expandedBefore) {
      expect(expandedAfter.has(p)).toBe(true);
    }
  });

  it("clear resets clipboard and renaming state", () => {
    const s = useFilesStore.getState();
    s.setTree("/tmp/jaffle_shop", sampleTree);
    s.setClipboard("/tmp/jaffle_shop/dbt_project.yml", "cut");
    s.setRenamingPath("/tmp/jaffle_shop/dbt_project.yml");
    s.clear();
    const after = useFilesStore.getState();
    expect(after.clipboardPath).toBeNull();
    expect(after.clipboardOp).toBeNull();
    expect(after.renamingPath).toBeNull();
    expect(after.tree).toBeNull();
  });

  it("findProjectRoot locates dbt_project.yml at any depth", () => {
    expect(findProjectRoot(sampleTree, ["dbt_project.yml"])).toBe("/tmp/jaffle_shop");
    const nested: FileTreeEntry = {
      name: "outer",
      path: "/o",
      isDir: true,
      children: [
        {
          name: "proj",
          path: "/o/proj",
          isDir: true,
          children: [
            {
              name: "config.yaml",
              path: "/o/proj/config.yaml",
              isDir: false,
              children: [],
            },
          ],
        },
      ],
    };
    expect(findProjectRoot(nested, ["config.yaml"])).toBe("/o/proj");
    expect(findProjectRoot(nested, ["nope.yml"])).toBeNull();
  });
});
