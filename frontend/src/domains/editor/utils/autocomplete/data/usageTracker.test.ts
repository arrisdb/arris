import { describe, it, expect } from "vitest";
import { UsageTracker } from "./usageTracker";

describe("UsageTracker", () => {
  it("returns 0 boost for unused identifiers", () => {
    const tracker = new UsageTracker();
    expect(tracker.boostFor("users")).toBe(0);
  });

  it("increases boost with usage", () => {
    const tracker = new UsageTracker();
    tracker.recordUsage("users");
    expect(tracker.boostFor("users")).toBe(0.5);
    tracker.recordUsage("users");
    expect(tracker.boostFor("users")).toBe(1);
  });

  it("caps boost at 3", () => {
    const tracker = new UsageTracker();
    for (let i = 0; i < 20; i++) tracker.recordUsage("users");
    expect(tracker.boostFor("users")).toBe(3);
  });

  it("tracks multiple identifiers independently", () => {
    const tracker = new UsageTracker();
    tracker.recordUsage("users");
    tracker.recordUsage("users");
    tracker.recordUsage("orders");
    expect(tracker.boostFor("users")).toBe(1);
    expect(tracker.boostFor("orders")).toBe(0.5);
  });

  it("clears all counts", () => {
    const tracker = new UsageTracker();
    tracker.recordUsage("users");
    tracker.clear();
    expect(tracker.boostFor("users")).toBe(0);
  });
});
