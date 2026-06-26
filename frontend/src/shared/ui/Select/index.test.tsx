import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Select } from "./index";

const options = [
  { value: "pg", label: "postgres-dev · postgres" },
  { value: "my", label: "mysql-prod · mysql" },
  { value: "sq", label: "local · sqlite" },
];

describe("Select", () => {
  it("renders trigger with selected label", () => {
    render(<Select value="pg" options={options} onChange={() => {}} />);
    expect(screen.getByRole("button").textContent).toContain("postgres-dev · postgres");
  });

  it("shows placeholder when no value matches", () => {
    render(<Select value="" options={options} onChange={() => {}} placeholder="Pick one" />);
    expect(screen.getByRole("button").textContent).toContain("Pick one");
  });

  it("opens dropdown on click and shows all options", () => {
    render(<Select value="pg" options={options} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("calls onChange and closes when option clicked", () => {
    const onChange = vi.fn();
    render(<Select value="pg" options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("mysql-prod · mysql"));
    expect(onChange).toHaveBeenCalledWith("my");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("marks selected option with aria-selected", () => {
    render(<Select value="my" options={options} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button"));
    const selected = screen.getAllByRole("option").find(
      (el) => el.getAttribute("aria-selected") === "true",
    );
    expect(selected).toBeTruthy();
    expect(selected!.textContent).toContain("mysql-prod · mysql");
  });

  it("closes on Escape key", () => {
    render(<Select value="pg" options={options} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on outside click", () => {
    render(<Select value="pg" options={options} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not open when disabled", () => {
    render(<Select value="pg" options={options} onChange={() => {}} disabled />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("carries mdbc-select class on trigger", () => {
    render(<Select value="pg" options={options} onChange={() => {}} data-testid="sel" />);
    expect(screen.getByTestId("sel").className).toContain("mdbc-select");
  });

  it("adds open class when dropdown visible", () => {
    render(<Select value="pg" options={options} onChange={() => {}} data-testid="sel" />);
    fireEvent.click(screen.getByTestId("sel"));
    expect(screen.getByTestId("sel").className).toContain("open");
  });

  it("renders footerAction as the last row in the menu", () => {
    render(
      <Select
        value="pg"
        options={options}
        onChange={() => {}}
        footerAction={{ label: "Browse…", onSelect: () => {} }}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const rows = screen.getAllByRole("option");
    expect(rows).toHaveLength(options.length + 1);
    expect(rows[rows.length - 1].textContent).toContain("Browse…");
    expect(rows[rows.length - 1].className).toContain("mdbc-select-action");
  });

  it("calls footerAction.onSelect and closes, without firing onChange", () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    render(
      <Select
        value="pg"
        options={options}
        onChange={onChange}
        footerAction={{ label: "Browse…", onSelect }}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("Browse…"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("omits footer row when footerAction not provided", () => {
    render(<Select value="pg" options={options} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByRole("option")).toHaveLength(options.length);
  });
});
