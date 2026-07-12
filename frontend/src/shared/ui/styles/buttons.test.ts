import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Design guard: a disabled `mdbc-btn` must LOOK disabled. Every button variant
// (including the base, unmodified `.mdbc-btn`) needs a `:disabled` rule, or a
// functionally disabled button renders identically to an enabled one (the
// canvas table pager shipped exactly this bug while a source streamed).
const css = readFileSync(
  resolve(process.cwd(), "src/shared/ui/styles/buttons.css"),
  "utf8",
);

describe("buttons.css", () => {
  it.each([
    ".mdbc-btn:disabled",
    ".mdbc-btn.primary:disabled",
    ".mdbc-btn.ghost:disabled",
    ".mdbc-btn.text-only:disabled",
  ])("styles %s", (selector) => {
    expect(css).toContain(selector);
  });
});
