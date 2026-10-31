import { describe, expect, it } from "vitest";
import { enableWebShell } from "./api";
import { registerPane, usePaneRegistry } from "./paneRegistry";

enableWebShell();

describe("pane registry in the browser", () => {
  it("drops desktop-only panes and keeps the rest", () => {
    const pane = { side: "left", kind: "primary", priority: 1, useActive: () => true, Component: () => null } as const;
    registerPane({ ...pane, id: "agent", nativeOnly: true });
    registerPane({ ...pane, id: "pins" });
    expect(Object.keys(usePaneRegistry.getState().panes)).toEqual(["pins"]);
  });
});
