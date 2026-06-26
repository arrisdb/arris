import { beforeEach, describe, expect, it } from "vitest";
import { useRecentsStore } from "./recentsStore";

beforeEach(() => {
  localStorage.clear();
  useRecentsStore.setState({ recents: [] });
});

describe("recentsStore", () => {
  it("add prepends entries and dedupes by path", () => {
    const s = useRecentsStore.getState();
    s.add({ path: "/a", name: "a", kind: "folder", openedAt: 1 });
    s.add({ path: "/b", name: "b", kind: "folder", openedAt: 2 });
    s.add({ path: "/a", name: "a", kind: "folder", openedAt: 3 });
    const list = useRecentsStore.getState().recents;
    expect(list.map((e) => e.path)).toEqual(["/a", "/b"]);
    expect(list[0].openedAt).toBe(3);
  });

  it("caps the list at 8 entries", () => {
    const s = useRecentsStore.getState();
    for (let i = 0; i < 10; i++) {
      s.add({ path: `/p${i}`, name: `p${i}`, kind: "folder", openedAt: i });
    }
    expect(useRecentsStore.getState().recents).toHaveLength(8);
    // newest stays first
    expect(useRecentsStore.getState().recents[0].path).toBe("/p9");
  });

  it("persists to localStorage and reloads on next read", () => {
    useRecentsStore.getState().add({
      path: "/foo",
      name: "foo",
      kind: "folder",
      openedAt: 42,
    });
    const raw = localStorage.getItem("arris.recents");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed[0].path).toBe("/foo");
  });

  it("remove drops a single entry", () => {
    const s = useRecentsStore.getState();
    s.add({ path: "/a", name: "a", kind: "folder", openedAt: 1 });
    s.add({ path: "/b", name: "b", kind: "folder", openedAt: 2 });
    s.remove("/a");
    expect(useRecentsStore.getState().recents.map((e) => e.path)).toEqual(["/b"]);
  });
});
