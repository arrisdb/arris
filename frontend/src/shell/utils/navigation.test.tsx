import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { navigate, useRoute } from "./navigation";

describe("navigation", () => {
  it("navigate keeps project param", () => {
    window.history.replaceState(null, "", "/?project=%2Fp");
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ kind: "history" });
    act(() => navigate("/pinned"));
    expect(window.location.pathname).toBe("/pinned");
    expect(new URLSearchParams(window.location.search).get("project")).toBe("/p");
    expect(result.current).toEqual({ kind: "pinned" });
  });

  it("navigate keeps the analytics dir param and drops others", () => {
    window.history.replaceState(null, "", "/dbt/models?project=%2Fp&dir=transform%2Fdbt&x=1");
    act(() => navigate("/dbt/lineage"));
    expect(window.location.search).toBe("?project=%2Fp&dir=transform%2Fdbt");
  });

  it("navigate without a project adds no query", () => {
    window.history.replaceState(null, "", "/");
    act(() => navigate("/connections"));
    expect(window.location.search).toBe("");
  });

  it("follows popstate", () => {
    window.history.replaceState(null, "", "/pinned");
    const { result } = renderHook(() => useRoute());
    window.history.replaceState(null, "", "/connections");
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current).toEqual({ kind: "connections" });
  });
});
