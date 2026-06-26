import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommandLogsView } from "./index";
import { CommandLogEntry } from "./components/CommandLogEntry";
import { useCommandLogStore } from "../../hooks/store";
import type { CommandLogEntry as CommandLogEntryModel } from "../../types";
import { useSettingsStore } from "@shared/settings";

function makeEntry(overrides: Partial<CommandLogEntryModel>): CommandLogEntryModel {
  return {
    id: "e1",
    kind: "dbt",
    command: "dbt run --select stg_customers",
    status: "success",
    startedAt: 1000,
    endedAt: 2200,
    durationMs: 1200,
    rawOutput: "",
    nodes: [],
    ...overrides,
  };
}

beforeEach(() => {
  useCommandLogStore.setState({ entries: [] });
});

describe("CommandLogsView", () => {
  it("renders the toolbar and an empty placeholder when there are no logs", () => {
    render(<CommandLogsView />);
    expect(screen.getByTestId("command-logs-toolbar")).toBeTruthy();
    expect(screen.getByText(/No command logs yet/)).toBeTruthy();
  });

  it("renders one row per command entry", () => {
    useCommandLogStore.setState({
      entries: [
        makeEntry({ id: "a", command: "dbt run --select orders" }),
        makeEntry({ id: "b", command: "sqlmesh plan dev", kind: "sqlmesh", status: "error" }),
      ],
    });
    render(<CommandLogsView />);
    expect(screen.getAllByTestId("command-log-entry")).toHaveLength(2);
  });

  it("filters entries by the filter-logs text input", () => {
    useCommandLogStore.setState({
      entries: [
        makeEntry({ id: "a", command: "dbt run --select orders" }),
        makeEntry({ id: "b", command: "sqlmesh plan dev", kind: "sqlmesh" }),
      ],
    });
    render(<CommandLogsView />);
    fireEvent.change(screen.getByPlaceholderText("Filter logs…"), {
      target: { value: "sqlmesh" },
    });
    expect(screen.getAllByTestId("command-log-entry")).toHaveLength(1);
    expect(screen.getByText("sqlmesh plan dev")).toBeTruthy();
  });

  it("clears all logs via the clear button", () => {
    useCommandLogStore.setState({ entries: [makeEntry({ id: "a" })] });
    render(<CommandLogsView />);
    fireEvent.click(screen.getByTitle("Clear logs"));
    expect(useCommandLogStore.getState().entries).toEqual([]);
    expect(screen.getByText(/No command logs yet/)).toBeTruthy();
  });

  it("collapses the bottom pane via the close button", () => {
    useSettingsStore.setState({ bottomPaneVisible: true });
    render(<CommandLogsView />);
    fireEvent.click(screen.getByTestId("command-logs-close"));
    expect(useSettingsStore.getState().bottomPaneVisible).toBe(false);
  });

  it("shows the newest run first", () => {
    useCommandLogStore.setState({
      entries: [
        makeEntry({ id: "old", command: "old cmd", startedAt: 1000 }),
        makeEntry({ id: "new", command: "new cmd", startedAt: 5000 }),
      ],
    });
    render(<CommandLogsView />);
    const rows = screen.getAllByTestId("command-log-entry");
    expect(rows[0].textContent).toContain("new cmd");
    expect(rows[1].textContent).toContain("old cmd");
  });

  it("auto-expands only the latest entry", () => {
    useCommandLogStore.setState({
      entries: [
        makeEntry({ id: "old", command: "old cmd", startedAt: 1000, rawOutput: "old out" }),
        makeEntry({ id: "new", command: "new cmd", startedAt: 5000, rawOutput: "new out" }),
      ],
    });
    render(<CommandLogsView />);
    const rows = screen.getAllByTestId("command-log-entry");
    // Newest (top) is expanded: its raw output is visible; the older one is collapsed.
    expect(rows[0].textContent).toContain("new out");
    expect(rows[0].textContent).toContain("Raw output");
    expect(rows[1].textContent).not.toContain("old out");
    expect(rows[1].textContent).not.toContain("Raw output");
  });

  it("renders a Raw query block for SQL entries but not CLI entries", () => {
    useCommandLogStore.setState({
      entries: [
        makeEntry({ id: "sql", kind: "sql", command: "SELECT 1\nFROM t", rawOutput: "ok" }),
      ],
    });
    const { rerender } = render(<CommandLogsView />);
    expect(screen.getByText("Raw query")).toBeTruthy();

    useCommandLogStore.setState({
      entries: [makeEntry({ id: "dbt", kind: "dbt", command: "dbt run", rawOutput: "ok" })],
    });
    rerender(<CommandLogsView />);
    expect(screen.queryByText("Raw query")).toBeNull();
  });
});

describe("CommandLogEntry", () => {
  const baseProps = {
    command: "dbt run --select stg_customers",
    status: "success" as const,
    durationLabel: "1.2s",
    timestampLabel: "10:35:02 AM",
    nodes: [],
    rawOutput: "",
  };

  it("is collapsed by default and expands on header click", () => {
    render(
      <CommandLogEntry
        {...baseProps}
        rawOutput="10:35:02 done"
        nodes={[{ name: "stg_customers", type: "view", status: "success", durationMs: 1200 }]}
      />,
    );
    expect(screen.queryByText("Raw output")).toBeNull();
    fireEvent.click(screen.getByText(baseProps.command));
    expect(screen.getByText("Raw output")).toBeTruthy();
    expect(screen.getByText("stg_customers")).toBeTruthy();
  });

  it("honors defaultExpanded", () => {
    render(<CommandLogEntry {...baseProps} rawOutput="hello" defaultExpanded />);
    expect(screen.getByText("Raw output")).toBeTruthy();
  });

  it("maps status to a status class", () => {
    const { container, rerender } = render(<CommandLogEntry {...baseProps} status="success" />);
    expect(container.querySelector(".mdbc-cmdlog-status.success")).toBeTruthy();
    rerender(<CommandLogEntry {...baseProps} status="error" />);
    expect(container.querySelector(".mdbc-cmdlog-status.error")).toBeTruthy();
    rerender(<CommandLogEntry {...baseProps} status="running" />);
    expect(container.querySelector(".mdbc-cmdlog-status.running")).toBeTruthy();
  });

  it("renders the per-node OK/ERROR breakdown when expanded", () => {
    render(
      <CommandLogEntry
        {...baseProps}
        defaultExpanded
        nodes={[
          { name: "stg_customers", type: "view", status: "success", durationMs: 1200 },
          { name: "not_null_id", type: "test", status: "error", durationMs: 800 },
        ]}
      />,
    );
    expect(screen.getByText("OK")).toBeTruthy();
    expect(screen.getByText("ERROR")).toBeTruthy();
    expect(screen.getByText("[test]")).toBeTruthy();
    expect(screen.getByText("800 ms")).toBeTruthy();
  });

  it("renders the source-tab badge when tabTitle is set", () => {
    render(<CommandLogEntry {...baseProps} tabTitle="Console 107" />);
    expect(screen.getByText("[Console 107]")).toBeTruthy();
  });

  it("renders errored raw output in red, success output neutral", () => {
    const { container, rerender } = render(
      <CommandLogEntry {...baseProps} defaultExpanded status="error" rawOutput="boom" />,
    );
    expect(container.querySelector(".mdbc-cmdlog-pre.error")).toBeTruthy();
    rerender(<CommandLogEntry {...baseProps} defaultExpanded status="success" rawOutput="ok" />);
    expect(container.querySelector(".mdbc-cmdlog-pre.error")).toBeNull();
  });

  it("shows a short raw query without a toggle", () => {
    const { container } = render(
      <CommandLogEntry {...baseProps} defaultExpanded rawQuery="SELECT 1" />,
    );
    expect(screen.getByText("Raw query")).toBeTruthy();
    expect(screen.queryByText("Show full query")).toBeNull();
    expect(container.querySelector(".mdbc-cmdlog-pre.capped")).toBeNull();
  });

  it("caps a long raw query and toggles it open", () => {
    const longQuery = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const { container } = render(
      <CommandLogEntry {...baseProps} defaultExpanded rawQuery={longQuery} />,
    );
    expect(container.querySelector(".mdbc-cmdlog-pre.capped")).toBeTruthy();
    fireEvent.click(screen.getByText("Show full query"));
    expect(container.querySelector(".mdbc-cmdlog-pre.capped")).toBeNull();
    expect(screen.getByText("Show less")).toBeTruthy();
  });

  it("renders a custom children body instead of the default", () => {
    render(
      <CommandLogEntry {...baseProps} defaultExpanded rawOutput="should-not-show">
        <div>View plan in Plan / Diff</div>
      </CommandLogEntry>,
    );
    expect(screen.getByText("View plan in Plan / Diff")).toBeTruthy();
    expect(screen.queryByText("Raw output")).toBeNull();
  });
});
