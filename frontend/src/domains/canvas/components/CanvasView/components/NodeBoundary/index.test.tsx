import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { NodeBoundary } from "./index";

function Boom(): never {
  throw new Error("boom");
}

describe("NodeBoundary", () => {
  it("renders its children when they don't throw", () => {
    render(
      <NodeBoundary>
        <div>ok</div>
      </NodeBoundary>,
    );
    expect(screen.getByText("ok")).toBeTruthy();
  });

  it("shows an inline fallback instead of crashing when a child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <NodeBoundary>
        <Boom />
      </NodeBoundary>,
    );
    expect(screen.getByText(/failed to render/i)).toBeTruthy();
    spy.mockRestore();
  });
});
