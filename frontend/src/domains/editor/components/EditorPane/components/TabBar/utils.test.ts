import { describe, expect, it } from "vitest";
import type { EditorTab } from "@shell/types";
import { iconForFileName } from "@shared/ui/Icon";
import { tabIconName } from "./utils";

function tab(partial: Partial<EditorTab> & Pick<EditorTab, "title">): EditorTab {
  return { id: "t1", text: "", kind: "sql", cursor: 0, ...partial };
}

describe("tabIconName", () => {
  it("resolves file tabs through the shared filename icon helper", () => {
    expect(tabIconName(tab({ title: "dim_products.sql", tabType: "file" }))).toBe("database");
    expect(tabIconName(tab({ title: "test_dim_customers.yaml", tabType: "file" }))).toBe("settings");
    expect(tabIconName(tab({ title: "utils.py", tabType: "file" }))).toBe("code");
    expect(tabIconName(tab({ title: "manifest.json", tabType: "file" }))).toBe("braces");
  });

  it("matches the icon the same file gets in the file tree", () => {
    for (const name of ["a.sql", "a.yaml", "a.py", "a.json", "a.md", "x.unknown"]) {
      expect(tabIconName(tab({ title: name, tabType: "file" }))).toBe(iconForFileName(name));
    }
  });

  it("maps non-file tab types to their fixed glyphs", () => {
    expect(tabIconName(tab({ title: "users", tabType: "table" }))).toBe("table");
    expect(tabIconName(tab({ title: "Terminal 1", tabType: "terminal" }))).toBe("terminal");
    expect(tabIconName(tab({ title: "Console 20", tabType: "console" }))).toBe("database");
    expect(tabIconName(tab({ title: "Notebook 2", tabType: "notebook" }))).toBe("notebook");
    expect(tabIconName(tab({ title: "Git Diff", tabType: "gitdiff" }))).toBe("gitBranch");
    expect(tabIconName(tab({ title: "Git History", tabType: "githistory" }))).toBe("history");
  });

  it("renders no leading icon for tab types without a glyph", () => {
    expect(tabIconName(tab({ title: "untyped" }))).toBeNull();
  });
});
