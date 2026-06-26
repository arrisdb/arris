import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { SearchInput } from "./index";

describe("SearchInput", () => {
  it("renders placeholder, value and a leading search icon", () => {
    render(<SearchInput value="abc" onChange={() => {}} placeholder="Filter" />);
    const input = screen.getByPlaceholderText("Filter") as HTMLInputElement;
    expect(input.value).toBe("abc");
    expect(input.className).toBe("mdbc-search-input");
    expect(document.querySelector(".mdbc-search-icon")).not.toBeNull();
  });

  it("emits the raw string value on change", () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} placeholder="Filter" />);
    fireEvent.change(screen.getByPlaceholderText("Filter"), {
      target: { value: "hello" },
    });
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("applies the size modifier to the wrapper", () => {
    const { rerender } = render(<SearchInput value="" onChange={() => {}} />);
    expect(document.querySelector(".mdbc-search.md")).not.toBeNull();
    rerender(<SearchInput value="" onChange={() => {}} size="sm" />);
    expect(document.querySelector(".mdbc-search.sm")).not.toBeNull();
  });

  it("forwards ref, testIds and aria-label", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <SearchInput
        value=""
        onChange={() => {}}
        inputRef={ref}
        ariaLabel="Search branches"
        testId="branch-input"
        rowTestId="branch-row"
      />,
    );
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByTestId("branch-row")).not.toBeNull();
    expect(screen.getByLabelText("Search branches")).toBe(
      screen.getByTestId("branch-input"),
    );
  });
});
