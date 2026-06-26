const DEFAULT_EDITOR_FONT_VALUE = "__default__";
const DEFAULT_EDITOR_FONT_LABEL = "Default";

// Fonts shipped with the app via @font-face (see styles/bundledFonts.css).
// These names ALWAYS render, so the picker can offer them regardless of what
// the user has installed. The strings must match the @font-face family names
// exactly. "Inter" is the sans UI option; the rest are monospace.
const BUNDLED_FONTS = [
  "Inter",
  "JetBrains Mono",
  "Fira Code",
  "Source Code Pro",
];

const MONO_FALLBACK = "var(--m-font-mono, ui-monospace, SFMono-Regular, monospace)";

function editorFontCssValue(family: string | null): string | null {
  if (!family) return null;
  return `${quoteFontFamily(family)}, ${MONO_FALLBACK}`;
}

function applyEditorFontFamily(family: string | null): void {
  const el = document.documentElement;
  const value = editorFontCssValue(family);
  if (value) {
    el.style.setProperty("--m-font-editor", value);
  } else {
    el.style.removeProperty("--m-font-editor");
  }
}

function uniqueFontFamilies(fonts: string[]): string[] {
  return Array.from(
    new Set(
      fonts
        .map((font) => font.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function quoteFontFamily(family: string): string {
  return `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export {
  DEFAULT_EDITOR_FONT_VALUE,
  DEFAULT_EDITOR_FONT_LABEL,
  BUNDLED_FONTS,
  editorFontCssValue,
  applyEditorFontFamily,
  uniqueFontFamilies,
};
