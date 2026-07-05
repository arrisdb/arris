import type { KeymapOverrides, KeymapPreset } from "../backendTypes";
import { ACTIONS, ACTION_ORDER, PRESET_OVERRIDES } from "./constants";
import type { KeymapAction, KeyShortcut, ShortcutMap } from "./types";

function sameShortcut(a: KeyShortcut | null, b: KeyShortcut | null): boolean {
  return (a?.key ?? null) === (b?.key ?? null);
}

function cloneShortcut(shortcut: KeyShortcut | null): KeyShortcut | null {
  return shortcut ? { key: shortcut.key } : null;
}

function normalizeShortcut(shortcut: KeyShortcut | string | null): KeyShortcut | null {
  if (shortcut == null) return null;
  if (typeof shortcut === "string") return { key: shortcut };
  return { key: shortcut.key };
}

function emptyOverrides(): KeymapOverrides {
  return { default: {}, vscode: {}, jetbrains: {} };
}

function presetBaseShortcut(preset: KeymapPreset, action: KeymapAction): KeyShortcut | null {
  const own = PRESET_OVERRIDES[preset][action];
  if (own !== undefined) return cloneShortcut(own);
  const fill = PRESET_OVERRIDES.default[action];
  if (fill !== undefined) return cloneShortcut(fill);
  return cloneShortcut(ACTIONS[action].defaultShortcut);
}

function presetBaseMap(preset: KeymapPreset): ShortcutMap {
  return Object.fromEntries(
    ACTION_ORDER.map((action) => [action, presetBaseShortcut(preset, action)]),
  ) as ShortcutMap;
}

function mergeOverrides(base: ShortcutMap, overrides: Partial<ShortcutMap>): ShortcutMap {
  const merged = { ...base };
  for (const action of ACTION_ORDER) {
    if (Object.prototype.hasOwnProperty.call(overrides, action)) {
      merged[action] = normalizeShortcut(overrides[action] ?? null);
    }
  }
  return merged;
}

function liveShortcuts(preset: KeymapPreset, overrides: KeymapOverrides): ShortcutMap {
  return mergeOverrides(presetBaseMap(preset), overrides[preset]);
}

export {
  sameShortcut,
  cloneShortcut,
  normalizeShortcut,
  emptyOverrides,
  presetBaseShortcut,
  presetBaseMap,
  mergeOverrides,
  liveShortcuts,
};
