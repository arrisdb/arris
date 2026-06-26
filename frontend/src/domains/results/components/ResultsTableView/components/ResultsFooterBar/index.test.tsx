import { useResultsTableStore, useRunHistoryStore } from "../../../../hooks";
import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ResultsFooterBar } from "./index";
import { useSettingsStore } from "@shared/settings";
import { useTabsStore } from "@shell/hooks/tabsStore";
beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeId: null, layout: null, focusedPaneGroupId: null });
  useRunHistoryStore.setState({ runsByTab: {}, selectedRunId: undefined, requestedPaneMode: null });
  useResultsTableStore.setState({ globalMode: "results", modeByTab: {} });
  useSettingsStore.setState({ bottomPaneVisible: true });
});

describe("ResultsFooterBar (global)", () => {
  it("toggling Command Logs drives the single global pane mode, not a per-tab one", () => {
    const { getByTestId } = render(<ResultsFooterBar global />);
    fireEvent.click(getByTestId("footer-output-tab"));
    expect(useResultsTableStore.getState().globalMode).toBe("output");
    // No per-tab mode is written: the global pane is detached from the active tab.
    expect(useResultsTableStore.getState().modeByTab).toEqual({});
  });

  it("clicking the active mode again collapses the bottom pane", () => {
    useResultsTableStore.setState({ globalMode: "results" });
    const { getByTestId } = render(<ResultsFooterBar global />);
    fireEvent.click(getByTestId("footer-results-tab"));
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(false);
  });

  it("works with no tab open (Command Logs reachable after a tab-less command)", () => {
    const { getByTestId } = render(<ResultsFooterBar global />);
    fireEvent.click(getByTestId("footer-output-tab"));
    expect(useResultsTableStore.getState().globalMode).toBe("output");
  });
});
