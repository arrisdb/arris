import { describe, it, expect, beforeEach } from "vitest";
import { applyTheme } from "./theme";

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("sets data-theme attribute on html element", () => {
    applyTheme("neon");
    expect(document.documentElement.getAttribute("data-theme")).toBe("neon");
  });

  it("switches between themes", () => {
    applyTheme("neon");
    expect(document.documentElement.getAttribute("data-theme")).toBe("neon");

    applyTheme("classicDark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("classicDark");

    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
