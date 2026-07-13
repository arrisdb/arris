import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { ChartView } from "./index";
import type { ChartSpec } from "@shared";
import type { QueryResult } from "@domains/results";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: () => <div data-testid="chart" />,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

const SPEC: ChartSpec = { kind: "bar", xColumn: "day", yColumns: ["amount"], title: "Revenue" };

const RESULT: QueryResult = {
  columns: [
    { name: "day", type_hint: "text" },
    { name: "amount", type_hint: "int" },
  ],
  rows: [[{ kind: "text", value: "Mon" }, { kind: "int", value: 10 }]],
  elapsed: 0,
};

describe("ChartView", () => {
  it("renders the chart when spec and data are present", () => {
    render(<ChartView spec={SPEC} result={RESULT} onEdit={vi.fn()} />);
    expect(screen.getByTestId("chart")).toBeTruthy();
  });

  it("does not crash on a malformed spec missing yColumns", () => {
    // A spec a bad agent edit or stale board could produce; the render guard must
    // coerce yColumns to an array rather than letting `undefined.map` throw.
    const bad = { kind: "bar", xColumn: "day" } as unknown as ChartSpec;
    expect(() => render(<ChartView spec={bad} result={RESULT} onEdit={vi.fn()} />)).not.toThrow();
    expect(screen.getByTestId("chart-view-empty")).toBeTruthy();
  });

  it("prompts to run a query when there is no result", () => {
    render(<ChartView spec={SPEC} result={undefined} onEdit={vi.fn()} />);
    expect(screen.getByTestId("chart-view-empty").textContent).toContain("Run a query");
  });

  it("prompts to customize when spec has no x/y", () => {
    render(<ChartView spec={undefined} result={RESULT} onEdit={vi.fn()} />);
    expect(screen.getByTestId("chart-view-empty").textContent).toContain("Configure the chart to view the data");
  });

  it("shows running state", () => {
    render(<ChartView spec={SPEC} result={undefined} isRunning onEdit={vi.fn()} />);
    expect(screen.getByTestId("chart-view-empty").textContent).toContain("Running");
  });

  it("shows error state", () => {
    render(<ChartView spec={SPEC} result={undefined} error="boom" onEdit={vi.fn()} />);
    expect(screen.getByTestId("chart-view-empty").textContent).toContain("boom");
  });

  it("clicking the edit button calls onEdit", () => {
    const onEdit = vi.fn();
    render(<ChartView spec={undefined} result={RESULT} onEdit={onEdit} />);
    fireEvent.click(screen.getByTestId("chart-view-edit"));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("hides the edit button when there is no result", () => {
    render(<ChartView spec={SPEC} result={undefined} onEdit={vi.fn()} />);
    expect(screen.queryByTestId("chart-view-edit")).toBeNull();
  });

  it("renders the chart title above the chart", () => {
    render(<ChartView spec={SPEC} result={RESULT} onEdit={vi.fn()} />);
    expect(screen.getByTestId("chart-view-title").textContent).toBe("Revenue");
  });

  it("omits the title element when no title is set", () => {
    render(<ChartView spec={{ ...SPEC, title: undefined }} result={RESULT} onEdit={vi.fn()} />);
    expect(screen.queryByTestId("chart-view-title")).toBeNull();
  });
});
