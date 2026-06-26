import { beforeEach, describe, expect, it } from "vitest";
import { useEditorHandleStore } from "./";

const fakeHandle = {
  insertAtCursor: () => ({ from: 0, to: 0 }),
  replaceRange: () => true,
} as never;

describe("useEditorHandleStore", () => {
  beforeEach(() => useEditorHandleStore.setState({ handle: null, activeTabId: null }));

  it("stores the active handle + tab id", () => {
    useEditorHandleStore.getState().setHandle(fakeHandle, "tab-1");
    expect(useEditorHandleStore.getState().handle).toBe(fakeHandle);
    expect(useEditorHandleStore.getState().activeTabId).toBe("tab-1");
  });

  it("clears the handle", () => {
    useEditorHandleStore.getState().setHandle(fakeHandle, "tab-1");
    useEditorHandleStore.getState().clearHandle();
    expect(useEditorHandleStore.getState().handle).toBeNull();
    expect(useEditorHandleStore.getState().activeTabId).toBeNull();
  });
});
