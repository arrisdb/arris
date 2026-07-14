import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ColorField } from "./index";

describe("ColorField", () => {
  it("opens the picker popover (portaled to the body) when the swatch is clicked", () => {
    render(<ColorField label="Fill" value="#ff0000" defaultColor="#000000" onChange={vi.fn()} />);
    expect(document.querySelector(".mdbc-colorfield-pop")).toBeNull();
    fireEvent.click(screen.getByLabelText("Fill"));
    expect(document.querySelector(".mdbc-colorfield-pop")).not.toBeNull();
    expect(document.querySelector(".react-colorful")).not.toBeNull();
  });

  it("shows the swatch as its colour, falling back to the default when unset", () => {
    const { rerender, container } = render(
      <ColorField label="Fill" value="#00ff00" defaultColor="#123456" onChange={vi.fn()} />,
    );
    const swatch = () => container.querySelector(".mdbc-colorfield-swatch") as HTMLElement;
    expect(swatch().classList.contains("is-none")).toBe(false);
    expect(swatch().style.getPropertyValue("--cf-swatch")).toBe("#00ff00");
    // Not none-able + unset: preview the default colour, never transparent.
    rerender(<ColorField label="Fill" value={undefined} defaultColor="#123456" onChange={vi.fn()} />);
    expect(swatch().classList.contains("is-none")).toBe(false);
    expect(swatch().style.getPropertyValue("--cf-swatch")).toBe("#123456");
  });

  it("shows a transparent (checker) swatch when none-able and unset", () => {
    const { container } = render(
      <ColorField label="Fill" value={undefined} defaultColor="#123456" allowNone onChange={vi.fn()} />,
    );
    expect(
      (container.querySelector(".mdbc-colorfield-swatch") as HTMLElement).classList.contains("is-none"),
    ).toBe(true);
  });

  it("offers a None swatch that clears to transparent only when allowNone", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ColorField label="Fill" value="#123456" defaultColor="#000000" onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText("Fill"));
    expect(screen.queryByLabelText("Transparent")).toBeNull();

    rerender(
      <ColorField label="Fill" value="#123456" defaultColor="#000000" allowNone onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText("Transparent"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("writes a hex the user types into the hex field", () => {
    const onChange = vi.fn();
    render(<ColorField label="Fill" value="#000000" defaultColor="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Fill"));
    fireEvent.change(screen.getByLabelText("Fill hex"), { target: { value: "abcdef" } });
    expect(onChange).toHaveBeenCalledWith("#abcdef");
  });

  it("closes the popover on Escape", () => {
    render(<ColorField label="Fill" value="#000000" defaultColor="#000000" onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Fill"));
    expect(document.querySelector(".mdbc-colorfield-pop")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".mdbc-colorfield-pop")).toBeNull();
  });

  it("closes the popover on an outside click", () => {
    render(<ColorField label="Fill" value="#000000" defaultColor="#000000" onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Fill"));
    expect(document.querySelector(".mdbc-colorfield-pop")).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(document.querySelector(".mdbc-colorfield-pop")).toBeNull();
  });
});
