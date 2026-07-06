import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  ACTION_ORDER,
  CATEGORY_ORDER,
  KEYMAP_PRESETS,
  PRESET_LABELS,
  presetBaseShortcut,
  useSettingsStore,
  type KeymapAction,
} from "@shared/settings";
import {
  captureShortcut,
  categoryOf,
  shortcutDisplay,
} from "@shell/utils";
import { DEFAULT_EDITOR_FONT_VALUE } from "@shared/ui/utils/editorFont";
import { buildFontOptions } from "./utils";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AUTO_SHELL_VALUE,
  FALLBACK_SHELLS,
} from "./constants";
import {
  settingsListEditorFontsIPC,
  settingsTerminalListShellsIPC,
} from "./ipc";
import type {
  KeymapCategoryGroup,
  KeymapConflict,
  SettingsViewModel,
} from "./types";

function useSettingsView(): SettingsViewModel {
  const open = useSettingsStore((state) => state.isOpen);
  const close = useSettingsStore((state) => state.close);
  const pane = useSettingsStore((state) => state.activePane);
  const setPane = useSettingsStore((state) => state.setPane);

  return { close, open, pane, setPane };
}

function useFontsPane() {
  const editorSize = useSettingsStore((state) => state.editorFontSize);
  const editorFontFamily = useSettingsStore((state) => state.editorFontFamily);
  const uiFontFamily = useSettingsStore((state) => state.uiFontFamily);
  const uiSize = useSettingsStore((state) => state.uiFontSize);
  const iconSize = useSettingsStore((state) => state.iconSize);
  const setEditor = useSettingsStore((state) => state.setEditorFontSize);
  const setEditorFontFamily = useSettingsStore((state) => state.setEditorFontFamily);
  const setUiFontFamily = useSettingsStore((state) => state.setUiFontFamily);
  const setUi = useSettingsStore((state) => state.setUiFontSize);
  const setIconSize = useSettingsStore((state) => state.setIconSize);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    settingsListEditorFontsIPC()
      .then((fonts) => {
        if (!cancelled) setSystemFonts(fonts);
      })
      .catch(() => {
        if (!cancelled) setSystemFonts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fontOptions = useMemo(() => buildFontOptions(systemFonts), [systemFonts]);

  function onEditorFontFamilyChange(value: string) {
    setEditorFontFamily(value === DEFAULT_EDITOR_FONT_VALUE ? null : value);
  }

  function onUiFontFamilyChange(value: string) {
    setUiFontFamily(value === DEFAULT_EDITOR_FONT_VALUE ? null : value);
  }

  return {
    editorFontFamily,
    editorSize,
    fontOptions,
    iconSize,
    onEditorFontFamilyChange,
    onUiFontFamilyChange,
    setEditor,
    setIconSize,
    setUi,
    uiFontFamily,
    uiSize,
  };
}

function useTerminalPane() {
  const terminalShell = useSettingsStore((state) => state.terminalShell);
  const setTerminalShell = useSettingsStore((state) => state.setTerminalShell);
  const terminalFontFamily = useSettingsStore((state) => state.terminalFontFamily);
  const setTerminalFontFamily = useSettingsStore((state) => state.setTerminalFontFamily);
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((state) => state.setTerminalFontSize);
  const [detectedShells, setDetectedShells] = useState<string[]>([]);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    settingsTerminalListShellsIPC()
      .then((shells) => {
        if (!cancelled) setDetectedShells(shells);
      })
      .catch(() => {
        if (!cancelled) setDetectedShells([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    settingsListEditorFontsIPC()
      .then((fonts) => {
        if (!cancelled) setSystemFonts(fonts);
      })
      .catch(() => {
        if (!cancelled) setSystemFonts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fontOptions = useMemo(() => buildFontOptions(systemFonts), [systemFonts]);

  const shellOptions = useMemo(() => {
    const shells = Array.from(new Set([...detectedShells, ...FALLBACK_SHELLS]));
    const options = [
      { value: AUTO_SHELL_VALUE, label: "Auto ($SHELL)" },
      ...shells.map((shell) => ({ value: shell, label: shell })),
    ];
    if (terminalShell && !shells.includes(terminalShell)) {
      options.push({ value: terminalShell, label: terminalShell });
    }
    return options;
  }, [detectedShells, terminalShell]);

  const selectedShell = terminalShell === "" ? AUTO_SHELL_VALUE : terminalShell;

  function onShellChange(value: string) {
    setTerminalShell(value === AUTO_SHELL_VALUE ? "" : value);
  }

  async function onBrowseShell() {
    const picked = await openDialog({ directory: false, multiple: false });
    if (typeof picked === "string") setTerminalShell(picked);
  }

  function onFontFamilyChange(value: string) {
    setTerminalFontFamily(value === DEFAULT_EDITOR_FONT_VALUE ? null : value);
  }

  return {
    fontOptions,
    onBrowseShell,
    onFontFamilyChange,
    onShellChange,
    selectedShell,
    setTerminalFontSize,
    shellOptions,
    terminalFontFamily,
    terminalFontSize,
  };
}

function useKeymapPane() {
  const shortcuts = useSettingsStore((state) => state.shortcuts);
  const setShortcut = useSettingsStore((state) => state.setShortcut);
  const reset = useSettingsStore((state) => state.reset);
  const keymapPreset = useSettingsStore((state) => state.keymapPreset);
  const setPreset = useSettingsStore((state) => state.setPreset);
  const [recording, setRecording] = useState<KeymapAction | null>(null);
  const [conflict, setConflict] = useState<KeymapConflict | null>(null);

  const actionsByCategory: KeymapCategoryGroup[] = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        actions: ACTION_ORDER.filter((action) => categoryOf(action) === category),
      })).filter((group) => group.actions.length > 0),
    [],
  );

  function shortcutKey(action: KeymapAction): string | null {
    return shortcuts[action]?.key ?? null;
  }

  function differsFromDefault(action: KeymapAction): boolean {
    return shortcutKey(action) !== (presetBaseShortcut(keymapPreset, action)?.key ?? null);
  }

  function recordShortcut(
    action: KeymapAction,
    event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  ) {
    if (event.key === "Escape") {
      setRecording(null);
      setConflict(null);
      return;
    }
    const captured = captureShortcut(event);
    if (!captured) return;
    const other = ACTION_ORDER.find(
      (candidate) => candidate !== action && shortcuts[candidate]?.key === captured.key,
    );
    if (other) {
      setConflict({ action, shortcut: captured, other });
      return;
    }
    setShortcut(action, captured);
    setRecording(null);
    setConflict(null);
  }

  function onCancelConflict() {
    setRecording(null);
    setConflict(null);
  }

  function onCaptureKey(action: KeymapAction, event: ReactKeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    recordShortcut(action, event.nativeEvent);
  }

  function onClearShortcut(action: KeymapAction) {
    setShortcut(action, null);
  }

  function onRecordShortcut(action: KeymapAction, event: ReactMouseEvent<HTMLButtonElement>) {
    event.currentTarget.focus();
    setRecording(action);
    setConflict(null);
  }

  function onReassignConflict() {
    if (!conflict) return;
    setShortcut(conflict.other, null);
    setShortcut(conflict.action, conflict.shortcut);
    setRecording(null);
    setConflict(null);
  }

  function onResetShortcut(action: KeymapAction) {
    setShortcut(action, presetBaseShortcut(keymapPreset, action));
  }

  useEffect(() => {
    if (!recording) return;
    const activeRecording = recording;
    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      recordShortcut(activeRecording, event);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, shortcuts]);

  return {
    actionsByCategory,
    conflict,
    differsFromDefault,
    keymapPreset,
    keymapPresets: KEYMAP_PRESETS,
    onCancelConflict,
    onCaptureKey,
    onClearShortcut,
    onReassignConflict,
    onRecordShortcut,
    onResetShortcut,
    presetLabels: PRESET_LABELS,
    recording,
    reset,
    setPreset,
    shortcutDisplay,
    shortcuts,
  };
}

export {
  useFontsPane,
  useKeymapPane,
  useSettingsView,
  useTerminalPane,
};
