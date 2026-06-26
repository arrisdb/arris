import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Tooltip, clampToViewport } from "./index";

describe("Tooltip", () => {
  it("renders children and a hidden tooltip with label", () => {
    render(
      <Tooltip label="Project">
        <button>click me</button>
      </Tooltip>,
    );
    expect(screen.getByText("click me")).toBeDefined();
    expect(screen.getByRole("tooltip")).toBeDefined();
    expect(screen.getByText("Project")).toBeDefined();
  });

  it("renders shortcut kbd when shortcut prop provided", () => {
    render(
      <Tooltip label="Git" shortcut="⌘ 2">
        <button>git</button>
      </Tooltip>,
    );
    const kbd = screen.getByText("⌘ 2");
    expect(kbd.tagName).toBe("KBD");
    expect(kbd.className).toContain("mdbc-tooltip-kbd");
  });

  it("omits kbd when no shortcut prop", () => {
    render(
      <Tooltip label="Files">
        <button>files</button>
      </Tooltip>,
    );
    expect(document.querySelector(".mdbc-tooltip kbd")).toBeNull();
  });

  it("tooltip starts hidden through the tokenized CSS-variable contract", () => {
    render(
      <Tooltip label="Agents" shortcut="⌘ 3">
        <button>agents</button>
      </Tooltip>,
    );
    const wrap = document.querySelector(".mdbc-tooltip-wrap");
    expect(wrap).toBeDefined();
    const tip = document.querySelector(".mdbc-tooltip");
    expect(tip).toBeDefined();
    expect((tip as HTMLElement).style.getPropertyValue("--mdbc-tooltip-opacity")).toBe("0");
  });
});

describe("clampToViewport", () => {
  it("returns left unchanged when tooltip fits within viewport", () => {
    expect(clampToViewport(500, 120, 1024)).toBe(500);
  });

  it("clamps left when tooltip would overflow right edge", () => {
    // tooltip center at 990, width 120 → right edge at 990+60=1050, viewport=1024
    // max = 1024 - 60 - 8 = 956
    expect(clampToViewport(990, 120, 1024)).toBe(956);
  });

  it("clamps left when tooltip would overflow left edge", () => {
    // tooltip center at 20, width 120 → left edge at 20-60=-40
    // min = 60 + 8 = 68
    expect(clampToViewport(20, 120, 1024)).toBe(68);
  });

  it("respects custom padding", () => {
    // max = 1024 - 60 - 16 = 948
    expect(clampToViewport(990, 120, 1024, 16)).toBe(948);
  });

  it("handles narrow viewport where min > max", () => {
    // tooltipWidth=200, viewport=100, padding=8 → halfWidth=100, min=108, max=-8
    // Math.max(108, Math.min(-8, 50)) = Math.max(108, -8) = 108
    expect(clampToViewport(50, 200, 100)).toBe(108);
  });
});
