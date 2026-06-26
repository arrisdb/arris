import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CsvTableView } from "./index";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { useSettingsStore } from "@shared/settings";
import type { EditorTab } from "@shell/types";

vi.mock("@domains/editor/utils/ui/setup", () => ({
  mountEditor: vi.fn(() => ({
    destroy: vi.fn(),
    updateDiffHunks: vi.fn(),
    insertAtCoords: vi.fn(),
    replaceRange: vi.fn(),
    reformat: vi.fn(),
  })),
}));

function csvTab(text: string, overrides?: Partial<EditorTab>): EditorTab {
  return {
    id: "csv-1",
    title: "test.csv",
    text,
    kind: "csv",
    cursor: 0,
    tabType: "file",
    filePath: "/project/seeds/test.csv",
    ...overrides,
  };
}

beforeEach(() => {
  useSettingsStore.setState({ editorFontSize: 13 });
});

describe("CsvTableView", () => {
  it("renders table mode by default with stats chip", () => {
    const tab = csvTab("name,age\nAlice,30\nBob,25\n");
    render(<CsvTableView tab={tab} />);

    const tableBtn = screen.getByTestId("csv-mode-table");
    expect(tableBtn.className).toContain("active");
    expect(screen.getByText("2 rows · 2 cols")).toBeTruthy();
    expect(screen.getByTestId("csv-table-container")).toBeTruthy();
  });

  it("toggles to raw mode", () => {
    const tab = csvTab("name,age\nAlice,30\n");
    render(<CsvTableView tab={tab} />);

    fireEvent.click(screen.getByTestId("csv-mode-raw"));
    expect(screen.getByTestId("csv-raw-editor")).toBeTruthy();
    expect(screen.getByTestId("csv-mode-raw").className).toContain("active");
  });

  it("shows empty state for empty CSV", () => {
    const tab = csvTab("");
    render(<CsvTableView tab={tab} />);

    expect(screen.getByTestId("csv-empty")).toBeTruthy();
    expect(screen.getByText("Empty CSV")).toBeTruthy();
  });

  it("renders headers in table", () => {
    const tab = csvTab("name,age\nAlice,30\n");
    render(<CsvTableView tab={tab} />);

    expect((screen.getByTestId("csv-header-0") as HTMLInputElement).value).toBe("name");
    expect((screen.getByTestId("csv-header-1") as HTMLInputElement).value).toBe("age");
  });

  it("add row updates tab text via store", () => {
    const tab = csvTab("name,age\nAlice,30\n");
    useTabsStore.setState({ tabs: [tab] });
    render(<CsvTableView tab={tab} />);

    fireEvent.click(screen.getByTestId("csv-add-row"));

    const updated = useTabsStore.getState().tabs.find((t) => t.id === "csv-1");
    expect(updated?.text).toBe("name,age\nAlice,30\n,\n");
  });

  it("header edit commits to store", () => {
    const tab = csvTab("name,age\nAlice,30\n");
    useTabsStore.setState({ tabs: [tab] });
    render(<CsvTableView tab={tab} />);

    const header = screen.getByTestId("csv-header-1");
    fireEvent.doubleClick(header);
    fireEvent.change(header, { target: { value: "years" } });
    fireEvent.blur(header);

    const updated = useTabsStore.getState().tabs.find((t) => t.id === "csv-1");
    expect(updated?.text).toBe("name,years\nAlice,30\n");
  });

  it("shows add row button only in table mode", () => {
    const tab = csvTab("name,age\nAlice,30\n");
    render(<CsvTableView tab={tab} />);

    expect(screen.getByTestId("csv-add-row")).toBeTruthy();

    fireEvent.click(screen.getByTestId("csv-mode-raw"));
    expect(screen.queryByTestId("csv-add-row")).toBeNull();
  });

  it("shows correct stats for header-only CSV", () => {
    const tab = csvTab("name,age\n");
    render(<CsvTableView tab={tab} />);

    expect(screen.getByText("0 rows · 2 cols")).toBeTruthy();
  });
});
