import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { makeComponent } from "../../../../../../utils";
import { TextSection } from "./index";

describe("TextSection", () => {
  it("writes font size and toggles bold", () => {
    const onChange = vi.fn();
    const comp = makeComponent({ kind: "text", id: "t" });
    const { container, getByLabelText } = render(
      <TextSection tabId="t" component={comp} onChange={onChange} />,
    );
    const size = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(size, { target: { value: "24" } });
    expect(onChange).toHaveBeenCalledWith({ style: { fontSize: 24 } });

    fireEvent.click(getByLabelText("Bold"));
    expect(onChange).toHaveBeenCalledWith({ style: { bold: true } });
  });

  it("toggles italic, underline, and strike run styles", () => {
    const onChange = vi.fn();
    const comp = makeComponent({ kind: "text", id: "t" });
    const { getByLabelText } = render(
      <TextSection tabId="t" component={comp} onChange={onChange} />,
    );
    fireEvent.click(getByLabelText("Italic"));
    expect(onChange).toHaveBeenCalledWith({ style: { italic: true } });
    fireEvent.click(getByLabelText("Underline"));
    expect(onChange).toHaveBeenCalledWith({ style: { underline: true } });
    fireEvent.click(getByLabelText("Strikethrough"));
    expect(onChange).toHaveBeenCalledWith({ style: { strike: true } });
  });

  it("clears a run style that is already active", () => {
    const onChange = vi.fn();
    const comp = makeComponent({ kind: "text", id: "t" });
    if (comp.kind === "text") comp.style = { bold: true };
    const { getByLabelText } = render(
      <TextSection tabId="t" component={comp} onChange={onChange} />,
    );
    fireEvent.click(getByLabelText("Bold"));
    expect(onChange).toHaveBeenCalledWith({ style: { bold: false } });
  });

  it("writes alignment", () => {
    const onChange = vi.fn();
    const comp = makeComponent({ kind: "text", id: "t" });
    const { getByLabelText } = render(
      <TextSection tabId="t" component={comp} onChange={onChange} />,
    );
    fireEvent.click(getByLabelText("Align center"));
    expect(onChange).toHaveBeenCalledWith({ style: { align: "center" } });
  });

  it("writes a text colour typed into the picker", () => {
    const onChange = vi.fn();
    const comp = makeComponent({ kind: "text", id: "t" });
    const { getByLabelText } = render(
      <TextSection tabId="t" component={comp} onChange={onChange} />,
    );
    fireEvent.click(getByLabelText("Text colour"));
    fireEvent.change(getByLabelText("Text colour hex"), { target: { value: "112233" } });
    expect(onChange).toHaveBeenCalledWith({ style: { color: "#112233" } });
  });

  it("clears the background to transparent via the picker's None swatch", () => {
    const onChange = vi.fn();
    const comp = makeComponent({ kind: "text", id: "t" });
    if (comp.kind === "text") comp.style = { backgroundColor: "#445566" };
    const { getByLabelText } = render(
      <TextSection tabId="t" component={comp} onChange={onChange} />,
    );
    fireEvent.click(getByLabelText("Background colour"));
    fireEvent.click(getByLabelText("Transparent"));
    expect(onChange).toHaveBeenCalledWith({ style: { backgroundColor: undefined } });
  });

  it("offers a None swatch for background but not for text colour", () => {
    const comp = makeComponent({ kind: "text", id: "t" });
    const { getByLabelText, queryByLabelText } = render(
      <TextSection tabId="t" component={comp} onChange={vi.fn()} />,
    );
    fireEvent.click(getByLabelText("Text colour"));
    expect(queryByLabelText("Transparent")).toBeNull();
  });

  it("renders nothing for a non-text object", () => {
    const comp = makeComponent({ kind: "shape", id: "s", shape: "rect" });
    const { container } = render(
      <TextSection tabId="t" component={comp} onChange={vi.fn()} />,
    );
    expect(container.querySelector(".mdbc-pane-form")).toBeNull();
  });

  it("uses in-app colour pickers for text and background", () => {
    const comp = makeComponent({ kind: "text", id: "t" });
    const { container } = render(
      <TextSection tabId="t" component={comp} onChange={vi.fn()} />,
    );
    expect(container.querySelectorAll(".mdbc-colorfield-swatch")).toHaveLength(2);
  });
});
