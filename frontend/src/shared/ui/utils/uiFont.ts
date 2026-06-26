// UI font family override. Unlike the editor font (which targets `--m-font-editor`
// on editor surfaces only), the chosen UI font overrides the base `--m-font` token
// so every chrome component that resolves `var(--m-font)` picks it up at once.

const UI_FALLBACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro", system-ui, sans-serif';

function quoteFontFamily(family: string): string {
  return `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function uiFontCssValue(family: string | null): string | null {
  if (!family) return null;
  return `${quoteFontFamily(family)}, ${UI_FALLBACK}`;
}

function applyUiFontFamily(family: string | null): void {
  const el = document.documentElement;
  const value = uiFontCssValue(family);
  if (value) {
    el.style.setProperty("--m-font", value);
  } else {
    el.style.removeProperty("--m-font");
  }
}

export { applyUiFontFamily, uiFontCssValue };
