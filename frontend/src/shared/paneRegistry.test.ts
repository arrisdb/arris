import { beforeEach, describe, expect, it } from "vitest";
import {
  activePrimary,
  activeSections,
  panesForSide,
  registerPane,
  resolvedSide,
  setPaneSide,
  usePaneRegistry,
  type PaneContribution,
} from "./paneRegistry";

const Noop = () => null;

function pane(overrides: Partial<PaneContribution> & Pick<PaneContribution, "id">): PaneContribution {
  return {
    side: "right",
    kind: "primary",
    priority: 0,
    useActive: () => true,
    Component: Noop,
    ...overrides,
  };
}

function mapOf(...panes: PaneContribution[]): Record<string, PaneContribution> {
  return Object.fromEntries(panes.map((p) => [p.id, p]));
}

describe("resolvedSide", () => {
  it("uses the contribution's default side when no override exists", () => {
    expect(resolvedSide(pane({ id: "a", side: "left" }), {})).toBe("left");
  });

  it("prefers a runtime override over the default side", () => {
    expect(resolvedSide(pane({ id: "a", side: "left" }), { a: "right" })).toBe("right");
  });
});

describe("panesForSide", () => {
  it("returns only panes resolved onto the side, highest priority first", () => {
    const panes = mapOf(
      pane({ id: "low", side: "right", priority: 1 }),
      pane({ id: "high", side: "right", priority: 5 }),
      pane({ id: "left", side: "left", priority: 9 }),
    );
    expect(panesForSide(panes, {}, "right").map((p) => p.id)).toEqual(["high", "low"]);
  });

  it("honors side overrides when bucketing", () => {
    const panes = mapOf(
      pane({ id: "a", side: "left", priority: 1 }),
      pane({ id: "b", side: "right", priority: 1 }),
    );
    expect(panesForSide(panes, { a: "right", b: "left" }, "right").map((p) => p.id)).toEqual(["a"]);
  });

  it("breaks priority ties by id for deterministic ordering", () => {
    const panes = mapOf(
      pane({ id: "zeta", priority: 3 }),
      pane({ id: "alpha", priority: 3 }),
    );
    expect(panesForSide(panes, {}, "right").map((p) => p.id)).toEqual(["alpha", "zeta"]);
  });

  it("filters by kind when one is given", () => {
    const panes = mapOf(
      pane({ id: "p", kind: "primary", side: "left" }),
      pane({ id: "s", kind: "section", side: "left" }),
    );
    expect(panesForSide(panes, {}, "left", "section").map((p) => p.id)).toEqual(["s"]);
  });
});

describe("activePrimary", () => {
  it("picks the highest-priority active primary", () => {
    const candidates = [
      pane({ id: "high", priority: 5 }),
      pane({ id: "mid", priority: 3 }),
      pane({ id: "default", priority: 0 }),
    ];
    expect(activePrimary(candidates, new Set(["mid", "default"]))?.id).toBe("mid");
  });

  it("falls back to a lower-priority default when nothing else is active", () => {
    const candidates = [pane({ id: "high", priority: 5 }), pane({ id: "default", priority: 0 })];
    expect(activePrimary(candidates, new Set(["default"]))?.id).toBe("default");
  });

  it("returns null when no primary is active", () => {
    const candidates = [pane({ id: "high", priority: 5 })];
    expect(activePrimary(candidates, new Set())).toBeNull();
  });

  it("ignores sections", () => {
    const candidates = [pane({ id: "sec", kind: "section", priority: 9 })];
    expect(activePrimary(candidates, new Set(["sec"]))).toBeNull();
  });
});

describe("activeSections", () => {
  it("returns every active section and skips primaries", () => {
    const candidates = [
      pane({ id: "consoles", kind: "section", priority: 2 }),
      pane({ id: "notebooks", kind: "section", priority: 1 }),
      pane({ id: "files", kind: "primary", priority: 9 }),
    ];
    const result = activeSections(candidates, new Set(["consoles", "files"]));
    expect(result.map((p) => p.id)).toEqual(["consoles"]);
  });
});

describe("registry store", () => {
  beforeEach(() => {
    usePaneRegistry.setState({ panes: {}, sideOverrides: {} });
  });

  it("registers panes by id", () => {
    registerPane(pane({ id: "files", side: "left", kind: "primary" }));
    expect(usePaneRegistry.getState().panes.files?.side).toBe("left");
  });

  it("re-registering the same id replaces the contribution", () => {
    registerPane(pane({ id: "files", priority: 1 }));
    registerPane(pane({ id: "files", priority: 2 }));
    expect(usePaneRegistry.getState().panes.files?.priority).toBe(2);
  });

  it("setSide records and clears overrides", () => {
    registerPane(pane({ id: "pinned", side: "right" }));
    setPaneSide("pinned", "left");
    expect(usePaneRegistry.getState().sideOverrides.pinned).toBe("left");
    setPaneSide("pinned", null);
    expect("pinned" in usePaneRegistry.getState().sideOverrides).toBe(false);
  });
});
