import type { CSSProperties } from "react";
import {
  BUNDLED_FONTS,
  DEFAULT_EDITOR_FONT_LABEL,
  DEFAULT_EDITOR_FONT_VALUE,
  uniqueFontFamilies,
} from "@shared/ui/utils/editorFont";

type FontOption = { value: string; label: string };

function visibilityStyle(visible: boolean, cssVariable: string) {
  return { [cssVariable]: visible ? "visible" : "hidden" } as CSSProperties;
}

// Build the font picker list. Bundled fonts come first: they ship with the
// app (@font-face) so they always render no matter what is installed. Then any
// system-installed families the OS reports (system_profiler gives real names
// like "Source Code Pro for Powerline", not "Source Code Pro"). We never offer
// an unverified name, so a chosen family always applies instead of silently
// falling back. Bundled names are dropped from the system list to avoid dupes.
function buildFontOptions(systemFonts: string[]): FontOption[] {
  const bundled = uniqueFontFamilies(BUNDLED_FONTS);
  const bundledSet = new Set(bundled);
  const installed = uniqueFontFamilies(systemFonts).filter(
    (font) => !bundledSet.has(font),
  );
  return [
    { value: DEFAULT_EDITOR_FONT_VALUE, label: DEFAULT_EDITOR_FONT_LABEL },
    ...[...bundled, ...installed].map((font) => ({ value: font, label: font })),
  ];
}

function keymapConflictMarginStyle() {
  return { "--mdbc-settings-keymap-conflict-margin-top": "-2px" } as CSSProperties;
}

function keymapRowHeightStyle(hasConflict: boolean) {
  return {
    "--mdbc-settings-keymap-row-min-height": hasConflict ? "58px" : "34px",
  } as CSSProperties;
}

export {
  buildFontOptions,
  keymapConflictMarginStyle,
  keymapRowHeightStyle,
  visibilityStyle,
};
