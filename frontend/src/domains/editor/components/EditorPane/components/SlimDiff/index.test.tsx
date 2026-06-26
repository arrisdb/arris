import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DbtDiffBar } from "./index";
import { DIFF_UNSUPPORTED_MESSAGE } from "./constants";
import { NO_CONNECTION_MESSAGE } from "../../utils";
import { useDbtStore } from "@domains/dbt/hooks";

function baseProps() {
  return {
    model: "orders",
    hasConnection: true,
    supported: true,
    running: false,
    onRun: vi.fn(),
    onClose: vi.fn(),
  };
}

describe("DbtDiffBar", () => {
  beforeEach(() => {
    useDbtStore.setState({ diffConfigByModel: {} });
  });

  it("renders the run control when the connection is supported", () => {
    render(<DbtDiffBar {...baseProps()} />);
    expect(screen.getByTestId("diffbar-run")).toBeTruthy();
  });

  it("shows a generic notice (no engine names) when the connection's dialect can't diff", () => {
    render(<DbtDiffBar {...baseProps()} supported={false} />);
    expect(screen.queryByTestId("diffbar-run")).toBeNull();
    const notice = screen.getByTestId("diffbar-notice");
    expect(notice.textContent).toBe(DIFF_UNSUPPORTED_MESSAGE);
    expect(notice.textContent).not.toMatch(/postgres|duckdb/i);
    expect(notice.className).toContain("error");
  });

  it("shows the shared no-connection message when no data source is selected", () => {
    render(<DbtDiffBar {...baseProps()} hasConnection={false} supported={false} />);
    expect(screen.queryByTestId("diffbar-run")).toBeNull();
    const notice = screen.getByTestId("diffbar-notice");
    expect(notice.textContent).toBe(NO_CONNECTION_MESSAGE);
    expect(notice.className).toContain("error");
  });

  it("emits an empty key list by default (keyless diff)", () => {
    const props = baseProps();
    render(<DbtDiffBar {...props} />);
    fireEvent.click(screen.getByTestId("diffbar-run"));
    expect(props.onRun).toHaveBeenCalledWith({ mode: "inline", sampleSize: 50, keyColumns: [] });
  });

  it("parses the comma-separated primary keys, trimming blanks", () => {
    const props = baseProps();
    render(<DbtDiffBar {...props} />);
    fireEvent.change(screen.getByTestId("diffbar-keys"), { target: { value: " id , region ,," } });
    fireEvent.click(screen.getByTestId("diffbar-run"));
    expect(props.onRun).toHaveBeenCalledWith({
      mode: "inline",
      sampleSize: 50,
      keyColumns: ["id", "region"],
    });
  });

  it("disables Run diff while a diff is in flight", () => {
    render(<DbtDiffBar {...baseProps()} running={true} />);
    expect((screen.getByTestId("diffbar-run") as HTMLButtonElement).disabled).toBe(true);
  });

  it("persists the config for the model on run", () => {
    render(<DbtDiffBar {...baseProps()} />);
    fireEvent.change(screen.getByTestId("diffbar-keys"), { target: { value: "id, region" } });
    fireEvent.click(screen.getByTestId("diffbar-run"));
    expect(useDbtStore.getState().diffConfigByModel["orders"]).toEqual({
      mode: "inline",
      sampleSize: 50,
      keyColumns: ["id", "region"],
    });
  });

  it("seeds the inputs from the model's previously saved config", () => {
    useDbtStore.setState({
      diffConfigByModel: { orders: { mode: "materialize", sampleSize: 200, keyColumns: ["id", "region"] } },
    });
    const props = baseProps();
    render(<DbtDiffBar {...props} />);
    expect((screen.getByTestId("diffbar-keys") as HTMLInputElement).value).toBe("id, region");
    fireEvent.click(screen.getByTestId("diffbar-run"));
    expect(props.onRun).toHaveBeenCalledWith({
      mode: "materialize",
      sampleSize: 200,
      keyColumns: ["id", "region"],
    });
  });

  it("keeps configs independent per model", () => {
    useDbtStore.setState({
      diffConfigByModel: { orders: { mode: "inline", sampleSize: 50, keyColumns: ["id"] } },
    });
    render(<DbtDiffBar {...baseProps()} model="customers" />);
    // A different model with no saved config falls back to the blank default.
    expect((screen.getByTestId("diffbar-keys") as HTMLInputElement).value).toBe("");
  });
});
