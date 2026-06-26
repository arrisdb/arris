import { useRunHistoryStore } from "../../hooks";
import { type QueryRunResult } from "../../types";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { RunHistoryChips } from "./index";
// Rename / pin go through store actions that persist via IPC; stub it out so
// the component tests don't reach Tauri.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

function run(over: Partial<QueryRunResult>): QueryRunResult {
  return {
    id: "r",
    seq: 1,
    ordinal: 1,
    tabId: "t1",
    tabTitle: "Console 1",
    startedAt: 0,
    status: "success",
    sqlSnapshot: "select 1",
    ...over,
  };
}

beforeEach(() => {
  useRunHistoryStore.setState({
    runsByTab: {},
    selectedRunId: undefined,
    nextSeqByTab: {},
    nextOrdinal: 1,
  });
});

describe("RunHistoryChips", () => {
  it("aggregates runs across tabs and labels each with its monotonic ordinal", () => {
    useRunHistoryStore.setState({
      runsByTab: {
        t1: [run({ id: "r1", ordinal: 1, tabId: "t1", tabTitle: "Console 1", startedAt: 1 })],
        t2: [run({ id: "r2", ordinal: 2, tabId: "t2", tabTitle: "Console 2", startedAt: 2 })],
      },
    });
    render(<RunHistoryChips />);
    expect(screen.getByText("#1 [Console 1]")).toBeTruthy();
    expect(screen.getByText("#2 [Console 2]")).toBeTruthy();
  });

  it("labels by ordinal, not array position, so closed runs leave gaps", () => {
    // Ordinals 5 and 7 survive even though only two chips remain.
    useRunHistoryStore.setState({
      runsByTab: {
        t1: [
          run({ id: "r5", ordinal: 5, startedAt: 1 }),
          run({ id: "r7", ordinal: 7, startedAt: 2 }),
        ],
      },
    });
    render(<RunHistoryChips />);
    expect(screen.getByText("#5 [Console 1]")).toBeTruthy();
    expect(screen.getByText("#7 [Console 1]")).toBeTruthy();
  });

  it("clicking a chip sets the global selection", () => {
    useRunHistoryStore.setState({
      runsByTab: {
        t1: [run({ id: "r1", ordinal: 1, startedAt: 1 })],
        t2: [run({ id: "r2", ordinal: 2, tabId: "t2", tabTitle: "Console 2", startedAt: 2 })],
      },
    });
    render(<RunHistoryChips />);
    fireEvent.click(screen.getByText("#1 [Console 1]"));
    expect(useRunHistoryStore.getState().selectedRunId).toBe("r1");
  });

  it("renders nothing when there are no runs", () => {
    const { container } = render(<RunHistoryChips />);
    expect(container.querySelector(".mdbc-runs-strip")).toBeNull();
  });

  it("pins a chip to the leftmost slot via the right-click 'Pinned Tab' menu item", () => {
    useRunHistoryStore.setState({
      runsByTab: {
        t1: [
          run({ id: "r1", ordinal: 1, startedAt: 1 }),
          run({ id: "r2", ordinal: 2, startedAt: 2 }),
        ],
      },
    });
    const { container } = render(<RunHistoryChips />);
    // r2 is the rightmost chip; right-click it and choose "Pinned Tab".
    const r2Chip = screen.getByText("#2 [Console 1]").closest(".mdbc-chip") as HTMLElement;
    fireEvent.contextMenu(r2Chip);
    fireEvent.click(screen.getByTestId("run-chip-pin"));
    expect(useRunHistoryStore.getState().runsByTab.t1[1].pinned).toBe(true);
    // Pinned chip now sorts first in the rendered track.
    const labels = Array.from(container.querySelectorAll(".mdbc-chip")).map(
      (chip) => chip.textContent,
    );
    expect(labels[0]).toContain("#2");
    expect(container.querySelector(".mdbc-chip.pinned")?.textContent).toContain("#2");
  });

  it("offers 'Unpin Tab' on an already-pinned chip and toggles it off", () => {
    useRunHistoryStore.setState({
      runsByTab: { t1: [run({ id: "r1", ordinal: 1, startedAt: 1, pinned: true })] },
    });
    render(<RunHistoryChips />);
    const chip = screen.getByText("#1 [Console 1]").closest(".mdbc-chip") as HTMLElement;
    fireEvent.contextMenu(chip);
    const item = screen.getByTestId("run-chip-pin");
    expect(item.textContent).toContain("Unpin Tab");
    fireEvent.click(item);
    expect(useRunHistoryStore.getState().runsByTab.t1[0].pinned).toBe(false);
  });

  it("renames a chip via the right-click 'Rename' menu item", () => {
    useRunHistoryStore.setState({
      runsByTab: { t1: [run({ id: "r1", ordinal: 1, startedAt: 1 })] },
    });
    render(<RunHistoryChips />);
    const chip = screen.getByText("#1 [Console 1]").closest(".mdbc-chip") as HTMLElement;
    fireEvent.contextMenu(chip);
    fireEvent.click(screen.getByTestId("run-chip-rename"));
    const input = screen.getByLabelText("Rename run") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "baseline" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useRunHistoryStore.getState().runsByTab.t1[0].customName).toBe("baseline");
  });

  it("double-clicking a chip renames it; Enter commits the custom label", () => {
    useRunHistoryStore.setState({
      runsByTab: { t1: [run({ id: "r1", ordinal: 1, startedAt: 1 })] },
    });
    render(<RunHistoryChips />);
    fireEvent.doubleClick(screen.getByText("#1 [Console 1]"));
    const input = screen.getByLabelText("Rename run") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "baseline" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useRunHistoryStore.getState().runsByTab.t1[0].customName).toBe("baseline");
    expect(screen.getByText("baseline")).toBeTruthy();
  });

  it("scrolls the strip to the rightmost (latest) run", () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(640);
    useRunHistoryStore.setState({
      runsByTab: {
        t1: [
          run({ id: "r1", ordinal: 1, startedAt: 1 }),
          run({ id: "r2", ordinal: 2, startedAt: 2 }),
          run({ id: "r3", ordinal: 3, startedAt: 3 }),
        ],
      },
    });
    const { container } = render(<RunHistoryChips />);
    const track = container.querySelector(".mdbc-runs-track") as HTMLElement;
    expect(track.scrollLeft).toBe(640);
    spy.mockRestore();
  });

  it("reveals a selected chip whose left edge is clipped", () => {
    useRunHistoryStore.setState({
      runsByTab: {
        t1: [
          run({ id: "r1", ordinal: 1, startedAt: 1 }),
          run({ id: "r2", ordinal: 2, startedAt: 2 }),
        ],
      },
      selectedRunId: "r2",
    });
    const { container } = render(<RunHistoryChips />);
    const track = container.querySelector(".mdbc-runs-track") as HTMLElement;
    const r1Chip = screen.getByText("#1 [Console 1]").closest(".mdbc-chip") as HTMLElement;
    // Track viewport starts at x=100; chip #1's left sits at x=70, clipped 30px
    // past the left edge.
    track.getBoundingClientRect = () => ({ left: 100, right: 400 }) as DOMRect;
    r1Chip.getBoundingClientRect = () => ({ left: 70, right: 150 }) as DOMRect;
    track.scrollLeft = 100;
    act(() => useRunHistoryStore.setState({ selectedRunId: "r1" }));
    // Flush would be 100 - (100 - 70) = 70; the 60px peek leaves the prior chip
    // partly visible → 70 - 60 = 10.
    expect(track.scrollLeft).toBe(10);
  });
});
