// Resolves the colour a token currently renders as, so the native picker opens
// on the live value when there is no user override yet.
function readSwatchColor(token: string): string {
  if (typeof window === "undefined") return "#000000";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--m-syn-${token}`)
    .trim();
  return value || "#000000";
}

export { readSwatchColor };
