import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MultiSelect } from "./index";

const options = [
  { value: "public", label: "public" },
  { value: "sales", label: "sales" },
];

describe("MultiSelect", () => {
  it("renders placeholder and toggles selected values", () => {
    const onChange = vi.fn();
    render(<MultiSelect values={[]} options={options} onChange={onChange} placeholder="Schemas" />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("listbox").getAttribute("aria-multiselectable")).toBe("true");
    fireEvent.click(screen.getByText("sales"));
    expect(onChange).toHaveBeenCalledWith(["sales"]);
  });

  it("summarizes multiple selections", () => {
    render(<MultiSelect values={["public", "sales"]} options={options} onChange={() => {}} />);
    expect(screen.getByRole("button").textContent).toContain("2 selected");
  });

  it("prefixes the summary with the term and shows 'All' when empty", () => {
    render(<MultiSelect values={[]} options={options} onChange={() => {}} prefix="Schemas" />);
    expect(screen.getByRole("button").textContent).toContain("Schemas: All");
  });

  it("prefixes a single selection with the term", () => {
    render(<MultiSelect values={["public"]} options={options} onChange={() => {}} prefix="Databases" />);
    expect(screen.getByRole("button").textContent).toContain("Databases: public");
  });

  it("renders every option checked when empty and selectAllWhenEmpty is set", () => {
    render(
      <MultiSelect values={[]} options={options} onChange={() => {}} prefix="Schemas" selectAllWhenEmpty />,
    );
    expect(screen.getByRole("button").textContent).toContain("Schemas: All");
    fireEvent.click(screen.getByRole("button"));
    const checked = screen.getAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true");
    expect(checked).toHaveLength(options.length);
  });

  it("unchecking an option in all-mode narrows to the remaining options", () => {
    const onChange = vi.fn();
    render(
      <MultiSelect values={[]} options={options} onChange={onChange} selectAllWhenEmpty />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("sales"));
    expect(onChange).toHaveBeenCalledWith(["public"]);
  });

  it("shows emptyLabel instead of the prefix summary when nothing is selected", () => {
    render(
      <MultiSelect
        values={[]}
        options={options}
        onChange={() => {}}
        prefix="Schemas"
        emptyLabel="Select schemas"
      />,
    );
    const text = screen.getByRole("button").textContent ?? "";
    expect(text).toContain("Select schemas");
    expect(text).not.toContain("Schemas: All");
  });

  it("ignores emptyLabel once a value is selected", () => {
    render(
      <MultiSelect
        values={["public"]}
        options={options}
        onChange={() => {}}
        prefix="Schemas"
        emptyLabel="Select schemas"
      />,
    );
    expect(screen.getByRole("button").textContent).toContain("Schemas: public");
  });

  it("re-selecting every option collapses back to the empty all-mode sentinel", () => {
    const onChange = vi.fn();
    render(
      <MultiSelect values={["public"]} options={options} onChange={onChange} selectAllWhenEmpty />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("sales"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("renders an 'All' row and a separator above the options when showSelectAll is set", () => {
    render(
      <MultiSelect
        values={["public"]}
        options={options}
        onChange={() => {}}
        selectAllWhenEmpty
        showSelectAll
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("multiselect-all")).toBeTruthy();
    const separator = screen.getByTestId("multiselect-separator");
    expect(separator).toBeTruthy();
    // The separator is not a selectable option.
    expect(separator.getAttribute("role")).toBe("separator");
  });

  it("clicking 'All' selects every schema (empty sentinel under selectAllWhenEmpty)", () => {
    const onChange = vi.fn();
    render(
      <MultiSelect
        values={["public"]}
        options={options}
        onChange={onChange}
        selectAllWhenEmpty
        showSelectAll
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByTestId("multiselect-all"));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("clicking 'All' emits the full value list when not selectAllWhenEmpty", () => {
    const onChange = vi.fn();
    render(
      <MultiSelect values={["public"]} options={options} onChange={onChange} showSelectAll />,
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByTestId("multiselect-all"));
    expect(onChange).toHaveBeenCalledWith(["public", "sales"]);
  });

  it("marks 'All' checked and clears on click when every value is selected (not selectAllWhenEmpty)", () => {
    const onChange = vi.fn();
    render(
      <MultiSelect
        values={["public", "sales"]}
        options={options}
        onChange={onChange}
        showSelectAll
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const all = screen.getByTestId("multiselect-all");
    expect(all.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(all);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("marks the 'All' row selected when everything is selected", () => {
    render(
      <MultiSelect
        values={[]}
        options={options}
        onChange={() => {}}
        selectAllWhenEmpty
        showSelectAll
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("multiselect-all").getAttribute("aria-selected")).toBe("true");
  });
});
