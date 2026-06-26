import { describe, expect, it } from "vitest";
import { centerPanelDefaultSize } from "./utils";

describe("centerPanelDefaultSize", () => {
  it("allocates less center space when both sidebars are visible", () => {
    expect(centerPanelDefaultSize(true, true)).toBe(71);
    expect(centerPanelDefaultSize(true, false)).toBe(85);
    expect(centerPanelDefaultSize(false, true)).toBe(85);
    expect(centerPanelDefaultSize(false, false)).toBe(100);
  });
});
