import { describe, it, expect, beforeEach } from "vitest";
import { useFederationStore } from "./federationStore";

describe("federation store", () => {
  beforeEach(() => {
    useFederationStore.setState({ tabs: [], activeId: null });
  });

  it("addTab focuses the new tab", () => {
    useFederationStore.getState().addTab({
      id: "t1",
      title: "Cross-source",
      participatingConnectionIds: [],
      text: "",
    });
    expect(useFederationStore.getState().activeId).toBe("t1");
  });

  it("toggleParticipant flips inclusion", () => {
    useFederationStore.getState().addTab({
      id: "t1",
      title: "x",
      participatingConnectionIds: [],
      text: "",
    });
    useFederationStore.getState().toggleParticipant("t1", "c1");
    expect(useFederationStore.getState().tabs[0].participatingConnectionIds).toEqual(["c1"]);
    useFederationStore.getState().toggleParticipant("t1", "c1");
    expect(useFederationStore.getState().tabs[0].participatingConnectionIds).toEqual([]);
  });

  it("setText updates only the matching tab", () => {
    useFederationStore.getState().addTab({
      id: "t1",
      title: "x",
      participatingConnectionIds: [],
      text: "",
    });
    useFederationStore.getState().setText("t1", "select 1");
    expect(useFederationStore.getState().tabs[0].text).toBe("select 1");
  });

  it("removeTab updates activeId fallback", () => {
    useFederationStore.getState().addTab({
      id: "a",
      title: "a",
      participatingConnectionIds: [],
      text: "",
    });
    useFederationStore.getState().addTab({
      id: "b",
      title: "b",
      participatingConnectionIds: [],
      text: "",
    });
    useFederationStore.getState().removeTab("b");
    expect(useFederationStore.getState().activeId).toBe("a");
  });
});
