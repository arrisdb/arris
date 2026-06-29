import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatBubble, ChatEmpty, ChatInput, ChatTyping } from "./index";

describe("ChatBubble", () => {
  it("carries the role class so user and agent bubbles align differently", () => {
    const { container } = render(<ChatBubble role="user" text="hello" />);
    const bubble = container.querySelector(".mdbc-agent-msg");
    expect(bubble?.className).toContain("user");
    expect(bubble?.textContent).toBe("hello");
  });
});

describe("ChatEmpty", () => {
  it("renders the centered title and hint", () => {
    render(<ChatEmpty title="Ask the agent" text="Describe an analysis." />);
    expect(screen.getByText("Ask the agent")).toBeTruthy();
    expect(screen.getByText("Describe an analysis.")).toBeTruthy();
  });
});

describe("ChatTyping", () => {
  it("exposes a Stop control wired to onStop", () => {
    const onStop = vi.fn();
    render(<ChatTyping onStop={onStop} />);
    fireEvent.click(screen.getByLabelText("Stop"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});

describe("ChatInput", () => {
  it("submits and clears on Cmd/Ctrl+Enter, ignoring a plain Enter", () => {
    const onSend = vi.fn();
    render(<ChatInput placeholder="Ask…" onSend={onSend} />);
    const box = screen.getByPlaceholderText("Ask…") as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: "monthly sales" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledWith("monthly sales");
    expect(box.value).toBe("");
  });

  it("does not submit blank input", () => {
    const onSend = vi.fn();
    render(<ChatInput placeholder="Ask…" onSend={onSend} />);
    const box = screen.getByPlaceholderText("Ask…");
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("renders an optional banner and disables the textarea", () => {
    render(
      <ChatInput
        placeholder="Ask…"
        disabled
        onSend={vi.fn()}
        banner={<div className="mdbc-agent-unavailable">offline</div>}
      />,
    );
    expect(screen.getByText("offline")).toBeTruthy();
    expect((screen.getByPlaceholderText("Ask…") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
