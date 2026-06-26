import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SectionedSelect } from "./index";

const modeOptions = [
  { value: "auto", label: "Auto" },
  { value: "manual", label: "Manual" },
];
const isoOptions = [
  { value: "default", label: "Database Default" },
  { value: "serializable", label: "Serializable" },
];

function renderWith(onMode = vi.fn(), onIso = vi.fn()) {
  render(
    <SectionedSelect
      triggerLabel="Tx: Auto"
      data-testid="tx"
      sections={[
        { title: "Transaction Mode", value: "auto", options: modeOptions, onChange: onMode },
        { title: "Transaction Isolation", value: "default", options: isoOptions, onChange: onIso },
      ]}
    />,
  );
  return { onMode, onIso };
}

describe("SectionedSelect", () => {
  it("renders the supplied trigger label", () => {
    renderWith();
    expect(screen.getByTestId("tx").textContent).toContain("Tx: Auto");
  });

  it("opens one menu with both section titles", () => {
    renderWith();
    fireEvent.click(screen.getByTestId("tx"));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByText("Transaction Mode")).toBeTruthy();
    expect(screen.getByText("Transaction Isolation")).toBeTruthy();
  });

  it("renders every option across all sections", () => {
    renderWith();
    fireEvent.click(screen.getByTestId("tx"));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(modeOptions.length + isoOptions.length);
  });

  it("routes a click to the owning section's onChange and closes", () => {
    const { onMode, onIso } = renderWith();
    fireEvent.click(screen.getByTestId("tx"));
    fireEvent.click(screen.getByText("Manual"));
    expect(onMode).toHaveBeenCalledWith("manual");
    expect(onIso).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("changes only the isolation section independently", () => {
    const { onMode, onIso } = renderWith();
    fireEvent.click(screen.getByTestId("tx"));
    fireEvent.click(screen.getByText("Serializable"));
    expect(onIso).toHaveBeenCalledWith("serializable");
    expect(onMode).not.toHaveBeenCalled();
  });

  it("marks the selected item in each section with aria-checked", () => {
    renderWith();
    fireEvent.click(screen.getByTestId("tx"));
    const checked = screen
      .getAllByRole("menuitemradio")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(2);
    expect(checked.map((el) => el.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Auto"), expect.stringContaining("Database Default")]),
    );
  });

  it("closes on Escape", () => {
    renderWith();
    fireEvent.click(screen.getByTestId("tx"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not fire onChange for a disabled option and keeps the menu open", () => {
    const onMode = vi.fn();
    render(
      <SectionedSelect
        triggerLabel="Tx: Manual"
        data-testid="tx"
        sections={[
          {
            title: "Transaction Mode",
            value: "manual",
            options: [
              { value: "auto", label: "Auto", disabled: true, hint: "Commit first" },
              { value: "manual", label: "Manual" },
            ],
            onChange: onMode,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("tx"));
    const auto = screen.getByText("Auto").closest(".mdbc-select-option") as HTMLElement;
    expect(auto.getAttribute("aria-disabled")).toBe("true");
    expect(auto.getAttribute("title")).toBe("Commit first");
    fireEvent.click(auto);
    expect(onMode).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("does not open when disabled", () => {
    render(
      <SectionedSelect
        triggerLabel="Tx: Auto"
        disabled
        data-testid="tx"
        sections={[{ title: "Transaction Mode", value: "auto", options: modeOptions, onChange: vi.fn() }]}
      />,
    );
    fireEvent.click(screen.getByTestId("tx"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
