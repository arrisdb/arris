import { beforeEach, describe, expect, it } from "vitest";
import { ACTIONS, ACTION_ORDER, CATEGORY_ORDER, useSettingsStore } from "@shared/settings";
import {
  captureShortcut,
  categoryOf,
  commandMenuItem,
  defaultShortcutFor,
  isBareKeySpec,
  isTypingTarget,
  labelFor,
  matchesShortcut,
  runCommand,
  shortcutDisplay,
} from "./keymap";
import { useCommandRegistryStore } from "../hooks/commandRegistryStore";

function key(spec: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return new KeyboardEvent("keydown", spec as KeyboardEventInit);
}

describe("matchesShortcut", () => {
  // jsdom userAgent contains "jsdom" (not Mac), so Mod === Ctrl.
  it("matches Mod-, with ctrlKey", () => {
    expect(matchesShortcut(key({ key: ",", ctrlKey: true }), "Mod-,")).toBe(true);
  });

  it("rejects when modifier missing", () => {
    expect(matchesShortcut(key({ key: "," }), "Mod-,")).toBe(false);
  });

  it("rejects when extra Shift held", () => {
    expect(
      matchesShortcut(key({ key: ",", ctrlKey: true, shiftKey: true }), "Mod-,"),
    ).toBe(false);
  });

  it("matches single-letter spec case-insensitively", () => {
    expect(matchesShortcut(key({ key: "B", ctrlKey: true }), "Mod-b")).toBe(true);
  });

  it("matches named keys (Enter)", () => {
    expect(matchesShortcut(key({ key: "Enter", ctrlKey: true }), "Mod-Enter")).toBe(true);
  });

  it("matches Mod-Alt-l", () => {
    expect(matchesShortcut(key({ key: "l", ctrlKey: true, altKey: true }), "Mod-Alt-l")).toBe(true);
  });

  it("matches a Mod-Alt-<letter> binding when Option composes a glyph into e.key (macOS)", () => {
    // macOS turns ⌥p into the composed glyph "π"; the physical key survives in e.code.
    expect(
      matchesShortcut(key({ key: "π", code: "KeyP", ctrlKey: true, altKey: true }), "Mod-Alt-p"),
    ).toBe(true);
  });

  it("falls back to e.code for digits too", () => {
    expect(
      matchesShortcut(key({ key: "¡", code: "Digit1", ctrlKey: true, altKey: true }), "Mod-Alt-1"),
    ).toBe(true);
  });
});

describe("ACTIONS registry", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().reset();
  });

  it("derives every action from the registry", () => {
    expect(ACTION_ORDER).toEqual(Object.keys(ACTIONS));
    expect(labelFor("showProjectPane")).toBe("Show Project");
    expect(categoryOf("exportCsv")).toBe("results");
    expect(CATEGORY_ORDER).toEqual([
      "editor",
      "tabs",
      "canvas",
      "navigation",
      "sidebar",
      "results",
      "edit",
      "git",
      "dbt",
      "sqlmesh",
    ]);
  });

  it("searchFiles has Mod-p binding", () => {
    expect(useSettingsStore.getState().shortcuts.searchFiles).toEqual({ key: "Mod-p" });
  });

  it("searchContent has Mod-Shift-f binding", () => {
    expect(useSettingsStore.getState().shortcuts.searchContent).toEqual({ key: "Mod-Shift-f" });
  });

  it("reformatCode has Mod-Alt-l binding", () => {
    expect(useSettingsStore.getState().shortcuts.reformatCode).toEqual({ key: "Mod-Alt-l" });
  });

  it("aiGenerate has Mod-k binding", () => {
    expect(useSettingsStore.getState().shortcuts.aiGenerate).toEqual({ key: "Mod-k" });
  });

  it("supports nullable shortcuts for button-only actions", () => {
    expect(defaultShortcutFor("stopQuery")).toBeNull();
    expect(useSettingsStore.getState().shortcuts.exportCsv).toBeNull();
  });

  it("persists only the diff from defaults", () => {
    useSettingsStore.getState().setShortcut("searchFiles", "Mod-Shift-p");
    useSettingsStore.getState().setShortcut("exportCsv", "Mod-Shift-c");
    expect(JSON.parse(localStorage.getItem("arris.keymap.shortcuts")!)).toEqual({
      searchFiles: { key: "Mod-Shift-p" },
      exportCsv: { key: "Mod-Shift-c" },
    });
  });

  it("hydrates defaults plus stored overrides and drops removed actions", () => {
    localStorage.setItem(
      "arris.keymap.shortcuts",
      JSON.stringify({ searchFiles: { key: "Mod-Shift-p" }, removedAction: { key: "Mod-x" } }),
    );
    useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().shortcuts.searchFiles).toEqual({ key: "Mod-Shift-p" });
    expect(useSettingsStore.getState().shortcuts.searchContent).toEqual({ key: "Mod-Shift-f" });
    expect((useSettingsStore.getState().shortcuts as Record<string, unknown>).removedAction).toBeUndefined();
  });

  it("formats shortcuts for settings and tooltips", () => {
    expect(shortcutDisplay("Mod-Enter")).toBe("⌘↵");
    expect(shortcutDisplay("Mod-Shift-f")).toBe("⌘⇧F");
    expect(shortcutDisplay(null)).toBeNull();
  });

  it("ignores modifier-only recordings", () => {
    expect(captureShortcut(key({ key: "Meta", metaKey: true }))).toBeNull();
    expect(captureShortcut(key({ key: "k", ctrlKey: true }))).toEqual({ key: "Mod-k" });
  });
});

describe("command registry bridge", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().reset();
    useCommandRegistryStore.setState({ handlers: new Map() });
  });

  it("runCommand invokes the registered handler", () => {
    let runs = 0;
    useCommandRegistryStore.getState().register("splitTop", { run: () => { runs += 1; }, isEnabled: () => true });
    expect(runCommand("splitTop")).toBe(true);
    expect(runs).toBe(1);
  });

  it("commandMenuItem builds a menu item that runs the command and shows its shortcut", () => {
    let runs = 0;
    useCommandRegistryStore.getState().register("splitTop", { run: () => { runs += 1; }, isEnabled: () => true });
    useSettingsStore.getState().setShortcut("splitTop", "Mod-Shift-t");
    const item = commandMenuItem("splitTop");
    expect(item).toMatchObject({ id: "splitTop", label: "Split Editor Top", shortcut: "⌘⇧T", disabled: false });
    if (item.kind !== "separator") item.action();
    expect(runs).toBe(1);
  });

  it("commandMenuItem is disabled when the command is not enabled", () => {
    useCommandRegistryStore.getState().register("splitTop", { run: () => {}, isEnabled: () => false });
    expect(commandMenuItem("splitTop")).toMatchObject({ disabled: true });
  });
});

describe("isBareKeySpec", () => {
  it("is true for a modifier-less spec (the canvas tool shortcuts)", () => {
    expect(isBareKeySpec("v")).toBe(true);
    expect(isBareKeySpec("/")).toBe(true);
    expect(isBareKeySpec("]")).toBe(true);
  });

  it("is false once any modifier is present", () => {
    expect(isBareKeySpec("Mod-Enter")).toBe(false);
    expect(isBareKeySpec("Shift-Enter")).toBe(false);
    expect(isBareKeySpec("Mod-Alt-l")).toBe(false);
    expect(isBareKeySpec("Ctrl-`")).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("is true for text-entry surfaces so bare keys keep typing", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    const cm = document.createElement("div");
    cm.className = "cm-editor";
    const inner = document.createElement("span");
    cm.appendChild(inner);
    expect(isTypingTarget(inner)).toBe(true);
  });

  it("is false for a plain element and for null", () => {
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
