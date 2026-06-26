import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConnectionKindPicker } from "./index";
import { pickerKinds } from "../utils/drivers/registry";

const groupByTitle = (title: string) =>
  Array.from(
    document.querySelectorAll<HTMLElement>(".mdbc-connection-picker-group"),
  ).find(
    (group) =>
      group.querySelector(".mdbc-connection-picker-group-title")?.textContent === title,
  );

describe("ConnectionKindPicker", () => {
  it("renders nothing when closed", () => {
    render(<ConnectionKindPicker open={false} onClose={() => {}} onSelect={() => {}} />);
    expect(screen.queryByTestId("connection-picker-list")).toBeNull();
  });

  it("lists every picker kind when open", () => {
    render(<ConnectionKindPicker open onClose={() => {}} onSelect={() => {}} />);
    const list = screen.getByTestId("connection-picker-list");
    expect(list.querySelectorAll(".mdbc-connection-picker-option")).toHaveLength(
      pickerKinds().length,
    );
  });

  it("groups Mixpanel under Others, not Databases", () => {
    render(<ConnectionKindPicker open onClose={() => {}} onSelect={() => {}} />);
    const databases = groupByTitle("Data sources");
    const others = groupByTitle("Others");
    expect(databases?.querySelector('[data-testid="connection-picker-option-mixpanel"]')).toBeNull();
    expect(
      others?.querySelector('[data-testid="connection-picker-option-mixpanel"]'),
    ).toBeTruthy();
  });

  it("orders the Databases group alphabetically by display name", () => {
    render(<ConnectionKindPicker open onClose={() => {}} onSelect={() => {}} />);
    const names = Array.from(
      groupByTitle("Data sources")?.querySelectorAll(".mdbc-connection-picker-option-name") ?? [],
    ).map((node) => node.textContent ?? "");
    expect(names[0]).toBe("BigQuery");
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("filters options as the user types", () => {
    render(<ConnectionKindPicker open onClose={() => {}} onSelect={() => {}} />);
    fireEvent.change(screen.getByTestId("connection-picker-search"), {
      target: { value: "postgre" },
    });
    expect(screen.getByTestId("connection-picker-option-postgres")).toBeTruthy();
    expect(screen.queryByTestId("connection-picker-option-mysql")).toBeNull();
  });

  it("calls onSelect with the clicked kind", () => {
    const onSelect = vi.fn();
    render(<ConnectionKindPicker open onClose={() => {}} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("connection-picker-option-postgres"));
    expect(onSelect).toHaveBeenCalledWith("postgres");
  });

  it("does not dismiss when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<ConnectionKindPicker open onClose={onClose} onSelect={() => {}} />);
    const backdrop = document.querySelector(".mdbc-sheet-backdrop");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).not.toHaveBeenCalled();
  });
});
