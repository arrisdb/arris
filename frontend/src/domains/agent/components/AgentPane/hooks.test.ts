import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorTab } from "@shell/types";

vi.mock("./ipc", () => ({
  listenAgentEventsIPC: vi.fn(() => Promise.resolve(() => {})),
  runShareQueryIPC: vi.fn(),
}));

import { useConnectionsStore } from "@domains/connection";
import { useRunHistoryStore } from "@domains/results/hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { useAgentStore } from "../../hooks/store";
import { useAgentPane } from "./hooks";

const TAB = "t1";
const tab = { id: TAB, title: "Console", text: "", tabType: "console" } as unknown as EditorTab;

const queryResult = {
  columns: [{ name: "category", type_hint: "text" }],
  rows: [[{ kind: "text", value: "Books" }]],
};

const run = (over: Record<string, unknown>) =>
  ({
    id: "r1",
    ordinal: 3,
    tabId: TAB,
    tabTitle: "Console",
    startedAt: 0,
    status: "success",
    sqlSnapshot: "select 1",
    result: queryResult,
    ...over,
  }) as never;

describe("useAgentPane result attachments", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [tab], activeId: TAB } as never);
    useConnectionsStore.setState({ connections: [], selectedId: null } as never);
    useRunHistoryStore.setState({ runsByTab: { [TAB]: [run({})] } } as never);
    vi.spyOn(useAgentStore.getState(), "checkAgent").mockResolvedValue(undefined as never);
    vi.spyOn(useAgentStore.getState(), "setActiveConnection").mockImplementation(() => {});
  });

  it("lists the active tab's run results as options", () => {
    const { result } = renderHook(() => useAgentPane());
    expect(result.current.resultOptions).toEqual([{ value: "r1", label: "#3 · 1×1" }]);
  });

  it("attaches a result as a removable chip and sends it as context", () => {
    const send = vi.spyOn(useAgentStore.getState(), "sendMessage").mockResolvedValue(undefined as never);
    const { result } = renderHook(() => useAgentPane());

    act(() => result.current.onAttachResult("r1"));
    const chip = result.current.chips.find((c) => c.kind === "result");
    expect(chip).toBeTruthy();
    expect(chip?.label).toBe("#3 · 1×1");
    expect(chip?.text).toContain("category (text)");

    act(() => result.current.onSend("describe it"));
    const chips = send.mock.calls[0][3];
    expect(chips.some((c) => c.kind === "result")).toBe(true);
    // One-shot: the result chip clears after the message is sent.
    expect(result.current.chips.some((c) => c.kind === "result")).toBe(false);
  });

  it("removes an attached result chip", () => {
    const { result } = renderHook(() => useAgentPane());
    act(() => result.current.onAttachResult("r1"));
    const id = result.current.chips.find((c) => c.kind === "result")!.id;
    act(() => result.current.onRemoveChip(id));
    expect(result.current.chips.some((c) => c.kind === "result")).toBe(false);
  });
});
