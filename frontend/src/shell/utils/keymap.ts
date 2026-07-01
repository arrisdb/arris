import { ACTIONS } from "@shared/settings";
import { useSettingsStore } from "@shared/settings";
import { useCommandRegistryStore } from "../hooks/commandRegistryStore";
import type { ContextMenuItem } from "@shared/ui/ContextMenu";
import type { KeymapAction, KeymapCategory, KeyShortcut } from "@shared/settings";
import { shortcutFor } from "@domains/editor/utils/shortcut";

function cloneShortcut(shortcut: KeyShortcut | null): KeyShortcut | null {
  return shortcut ? { key: shortcut.key } : null;
}

function normalizeShortcut(shortcut: KeyShortcut | string | null): KeyShortcut | null {
  if (shortcut == null) return null;
  if (typeof shortcut === "string") return { key: shortcut };
  return { key: shortcut.key };
}

function labelFor(action: KeymapAction): string {
  return ACTIONS[action].label;
}

function categoryOf(action: KeymapAction): KeymapCategory {
  return ACTIONS[action].category;
}

function defaultShortcutFor(action: KeymapAction): KeyShortcut | null {
  return cloneShortcut(ACTIONS[action].defaultShortcut);
}

function shortcutDisplay(shortcut: KeyShortcut | string | null): string | null {
  const key = normalizeShortcut(shortcut)?.key;
  if (!key) return null;
  const symbols: Record<string, string> = {
    Mod: "⌘",
    Alt: "⌥",
    Shift: "⇧",
    Ctrl: "⌃",
    Enter: "↵",
    Tab: "⇥",
    Backspace: "⌫",
    Escape: "Esc",
    " ": "Space",
  };
  return key
    .split("-")
    .map((part) => symbols[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join("");
}

function captureShortcut(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
): KeyShortcut | null {
  if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.key) parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.length > 0 ? { key: parts.join("-") } : null;
}

function matchesShortcut(e: KeyboardEvent, spec: string): boolean {
  const parts = spec.split("-");
  const key = parts.pop() ?? "";
  const wantMod = parts.includes("Mod");
  const wantShift = parts.includes("Shift");
  const wantAlt = parts.includes("Alt");
  const wantCtrl = parts.includes("Ctrl");
  const isMac =
    typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.userAgent);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (wantMod !== mod) return false;
  if (wantShift !== e.shiftKey) return false;
  if (wantAlt !== e.altKey) return false;
  if (wantCtrl !== (isMac ? e.ctrlKey : false)) return false;
  const eKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const kKey = key.length === 1 ? key.toLowerCase() : key;
  if (eKey === kKey) return true;
  // On macOS, holding Option composes a glyph into `e.key` (⌥p → "π"), so a
  // Mod-Alt-<letter> binding never matches by key. Fall back to the physical
  // key from `e.code` (KeyP → "p", Digit1 → "1") for single-char bindings.
  if (kKey.length === 1 && e.code) {
    const physical = e.code.replace(/^(Key|Digit)/, "").toLowerCase();
    if (physical === kKey) return true;
  }
  return false;
}

// A shortcut spec with no Mod/Ctrl/Alt/Shift modifier is a bare key (e.g. the
// canvas "v"/"r"/"/" tool shortcuts). Bare keys would otherwise hijack ordinary
// typing, so the global keymap suppresses them while a text surface is focused.
function isBareKeySpec(spec: string): boolean {
  const parts = spec.split("-");
  return !parts.some((p) => p === "Mod" || p === "Ctrl" || p === "Alt" || p === "Shift");
}

// True when a key event targets a text-entry surface (input, textarea, select,
// contenteditable, or a CodeMirror editor) where bare-key shortcuts must yield
// to normal typing.
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.closest(".cm-editor");
}

function runCommand(action: KeymapAction): boolean {
  return useCommandRegistryStore.getState().run(action);
}

function commandMenuItem(
  action: KeymapAction,
  opts?: { testId?: string; disabled?: boolean },
): ContextMenuItem {
  const registry = useCommandRegistryStore.getState();
  const shortcut = useSettingsStore.getState().shortcuts[action];
  return {
    id: action,
    label: ACTIONS[action].label,
    shortcut: shortcutDisplay(shortcut) ?? undefined,
    disabled: opts?.disabled ?? !registry.isEnabled(action),
    testId: opts?.testId,
    action: () => {
      runCommand(action);
    },
  };
}

export {
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
  shortcutFor,
};
