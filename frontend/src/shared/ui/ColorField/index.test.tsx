import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ColorField } from "./index";

describe("ColorField", () => {
  it("opens the picker popover when the swatch is clicked", () => {
    const { container } = render(
      <ColorField label="Fill" value="#ff0000" defaultColor="#000000" onChange={vi.fn()} />,
    );
    expect(container.querySelector(".mdbc-colorfield-pop")).toBeNull();
    fireEvent.click(screen.getByLabelText("Fill"));
    expect(container.querySelector(".mdbc-colorfield-pop")).not.toBeNull();
    expect(container.querySelector(".react-colorful")).not.toBeNull();
  });

  it("shows the swatch as a colour, or transparent when unset", () => {
    const { rerender, container } = render(
      <ColorField label="Fill" value="#00ff00" defaultColor="#000000" onChange={vi.fn()} />,
    );
    const swatch = container.querySelector(".mdbc-colorfield-swatch") as HTMLElement;
    expect(swatch.classList.contains("is-none")).toBe(false);
    expect(swatch.style.background).toBe("rgb(0, 255, 0)");
    rerender(
      <ColorField label="Fill" value={undefined} defaultColor="#000000" onChange={vi.fn()} />,
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
    expect(screen.queryByLabelText("No fill")).toBeNull();

    rerender(
      <ColorField label="Fill" value="#123456" defaultColor="#000000" allowNone onChange={onChange} />,
    );
    fireEvent.click(screen.getByLabelText("No fill"));
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
    const { container } = render(
      <ColorField label="Fill" value="#000000" defaultColor="#000000" onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Fill"));
    expect(container.querySelector(".mdbc-colorfield-pop")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector(".mdbc-colorfield-pop")).toBeNull();
  });
});
