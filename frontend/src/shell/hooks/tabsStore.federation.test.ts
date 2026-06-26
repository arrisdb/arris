import { describe, it, expect, beforeEach } from "vitest";
import { useTabsStore } from "./tabsStore";

describe("federation toggle on query tabs", () => {
  beforeEach(() => {
    useTabsStore.setState({
      tabs: [],
      layout: { kind: "leaf", id: "g1", tabIds: [], selectedTabId: null },
      activeId: null,
      focusedPaneGroupId: "g1",
    });
  });

  it("addTab creates non-federation tab by default", () => {
    useTabsStore.getState().addTab({ kind: "sql", connectionId: "c1" });
    const tab = useTabsStore.getState().tabs[0];
    expect(tab.isFederation).toBeUndefined();
    expect(tab.connectionId).toBe("c1");
  });

  it("updateTab sets isFederation and clears connectionId", () => {
    useTabsStore.getState().addTab({ kind: "sql", connectionId: "c1" });
    const tab = useTabsStore.getState().tabs[0];
    useTabsStore.getState().updateTab(tab.id, {
      isFederation: true,
      connectionId: undefined,
      kind: "sql",
    });
    const updated = useTabsStore.getState().tabs[0];
    expect(updated.isFederation).toBe(true);
    expect(updated.connectionId).toBeUndefined();
    expect(updated.kind).toBe("sql");
  });

  it("switching back to connection clears federation flag", () => {
    useTabsStore.getState().addTab({ kind: "sql" });
    const tab = useTabsStore.getState().tabs[0];
    useTabsStore.getState().updateTab(tab.id, { isFederation: true });
    useTabsStore.getState().updateTab(tab.id, {
      isFederation: false,
      connectionId: "c2",
      kind: "sql",
    });
    const updated = useTabsStore.getState().tabs[0];
    expect(updated.isFederation).toBe(false);
    expect(updated.connectionId).toBe("c2");
  });

  it("multiple tabs can have independent federation flags", () => {
    useTabsStore.getState().addTab({ kind: "sql", connectionId: "c1" });
    useTabsStore.getState().addTab({ kind: "sql", connectionId: "c2" });
    const tabs = useTabsStore.getState().tabs;
    useTabsStore.getState().updateTab(tabs[0].id, { isFederation: true });
    const updated = useTabsStore.getState().tabs;
    expect(updated[0].isFederation).toBe(true);
    expect(updated[1].isFederation).toBeUndefined();
  });
});
