import { beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { registerTabView, useTabView, useTabViewRegistry } from "./tabViewRegistry";

const Dummy = () => null;
const Other = () => null;

beforeEach(() => {
  useTabViewRegistry.setState({ views: {} });
});

describe("tabViewRegistry", () => {
  it("registers a contribution keyed by tabType", () => {
    registerTabView({ tabType: "notebook", Component: Dummy });
    expect(useTabViewRegistry.getState().views.notebook?.Component).toBe(Dummy);
  });

  it("last registration for a tabType wins", () => {
    registerTabView({ tabType: "notebook", Component: Dummy });
    registerTabView({ tabType: "notebook", Component: Other });
    expect(useTabViewRegistry.getState().views.notebook?.Component).toBe(Other);
  });

  it("preserves the wrap flag", () => {
    registerTabView({ tabType: "media", wrap: false, Component: Dummy });
    expect(useTabViewRegistry.getState().views.media?.wrap).toBe(false);
  });

  it("useTabView resolves a registered type", () => {
    registerTabView({ tabType: "notebook", Component: Dummy });
    const { result } = renderHook(() => useTabView("notebook"));
    expect(result.current?.Component).toBe(Dummy);
  });

  it("useTabView returns null for an unregistered or undefined type", () => {
    const { result: missing } = renderHook(() => useTabView("nope"));
    expect(missing.current).toBeNull();
    const { result: none } = renderHook(() => useTabView(undefined));
    expect(none.current).toBeNull();
  });
});
