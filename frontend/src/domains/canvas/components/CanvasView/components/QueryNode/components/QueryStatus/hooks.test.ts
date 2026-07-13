import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useLiveElapsed } from "./hooks";

describe("useLiveElapsed", () => {
  it("returns null when there is no run in flight", () => {
    const { result } = renderHook(() => useLiveElapsed(undefined));
    expect(result.current).toBeNull();
  });

  it("returns a non-negative elapsed while running", () => {
    const { result } = renderHook(() => useLiveElapsed(Date.now()));
    expect(typeof result.current).toBe("number");
    expect(result.current!).toBeGreaterThanOrEqual(0);
  });

  it("drops back to null when the run stops", () => {
    const { result, rerender } = renderHook(({ s }) => useLiveElapsed(s), {
      initialProps: { s: Date.now() as number | undefined },
    });
    expect(typeof result.current).toBe("number");
    rerender({ s: undefined });
    expect(result.current).toBeNull();
  });
});
