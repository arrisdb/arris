import { describe, it, expect, beforeEach } from "vitest";
import { useCommandRegistryStore } from "./commandRegistryStore";

beforeEach(() => {
  useCommandRegistryStore.setState({ handlers: new Map() });
});

describe("command registry", () => {
  it("runs a registered handler and reports it handled", () => {
    let runs = 0;
    const handler = { run: () => { runs += 1; }, isEnabled: () => true };
    useCommandRegistryStore.getState().register("splitTop", handler);
    expect(useCommandRegistryStore.getState().run("splitTop")).toBe(true);
    expect(runs).toBe(1);
  });

  it("returns false for an unregistered command without throwing", () => {
    expect(useCommandRegistryStore.getState().run("splitTop")).toBe(false);
  });

  it("does not run a disabled command", () => {
    let runs = 0;
    useCommandRegistryStore.getState().register("splitTop", {
      run: () => { runs += 1; },
      isEnabled: () => false,
    });
    expect(useCommandRegistryStore.getState().run("splitTop")).toBe(false);
    expect(runs).toBe(0);
  });

  it("reports enabled state per command", () => {
    useCommandRegistryStore.getState().register("splitTop", { run: () => {}, isEnabled: () => false });
    useCommandRegistryStore.getState().register("splitLeft", { run: () => {}, isEnabled: () => true });
    expect(useCommandRegistryStore.getState().isEnabled("splitTop")).toBe(false);
    expect(useCommandRegistryStore.getState().isEnabled("splitLeft")).toBe(true);
    expect(useCommandRegistryStore.getState().isEnabled("splitRight")).toBe(false);
  });

  it("does not clobber a newer owner when a stale handler unregisters", () => {
    const first = { run: () => {}, isEnabled: () => true };
    const second = { run: () => {}, isEnabled: () => true };
    useCommandRegistryStore.getState().register("splitTop", first);
    useCommandRegistryStore.getState().register("splitTop", second);
    useCommandRegistryStore.getState().unregister("splitTop", first);
    expect(useCommandRegistryStore.getState().handlers.get("splitTop")).toBe(second);
  });
});
