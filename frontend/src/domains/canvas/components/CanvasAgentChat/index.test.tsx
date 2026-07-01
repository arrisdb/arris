import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { EditorTab } from "@shell/types";

import type { ChatEntry } from "./types";

// Stub the provider picker (it reads the agent store) and drive the component
// through a controlled hook return.
vi.mock("@domains/agent", () => ({ AgentProviderSelect: () => null }));

const hooked = vi.hoisted(() => ({
  entries: [] as ChatEntry[],
  clearChat: vi.fn(),
}));

vi.mock("./hooks", () => ({
  useCanvasAgentChat: () => ({
    answerQuestion: vi.fn(),
    buildContext: () => "",
    cancel: vi.fn(),
    clearChat: hooked.clearChat,
    connectionId: "c1",
    connectionIds: ["c1"],
    connectionOptions: [{ value: "c1", label: "PG" }],
    describeQuery: () => ({ title: "Q", hasResult: false, rowCount: 0, colCount: 0 }),
    entries: hooked.entries,
    pickConnections: vi.fn(),
    schemaLoading: false,
    send: vi.fn(),
    streaming: false,
  }),
}));

import { CanvasAgentChat } from "./index";

const tab = { id: "tab-1", text: "" } as unknown as EditorTab;

describe("CanvasAgentChat rendering", () => {
  it("renders the agent reply as markdown and the user message as plain text", () => {
    hooked.entries = [
      { id: "u1", role: "user", text: "plain **not bold** user" },
      { id: "a1", role: "agent", text: "## Heading\n\n- item with `code`" },
    ];
    const { container } = render(<CanvasAgentChat tab={tab} />);

    // The agent bubble renders markdown to real HTML elements.
    const md = container.querySelector(".mdbc-canvas-chat-md");
    expect(md).toBeTruthy();
    expect(md?.querySelector("h2")?.textContent).toBe("Heading");
    expect(md?.querySelector("li code")?.textContent).toBe("code");

    // The user bubble stays literal: no markdown processing, so the ** survives.
    const user = container.querySelector(".mdbc-agent-msg.user");
    expect(user?.textContent).toBe("plain **not bold** user");
    expect(user?.querySelector("strong")).toBeNull();
  });

  it("aligns each turn by role and shows the action chip", () => {
    hooked.entries = [
      { id: "a1", role: "agent", text: "Done.", action: 'Added query "Sales".' },
    ];
    const { container } = render(<CanvasAgentChat tab={tab} />);
    expect(container.querySelector(".mdbc-canvas-chat-row.agent")).toBeTruthy();
    const action = container.querySelector(".mdbc-canvas-chat-action");
    expect(action?.textContent).toContain('Added query "Sales".');
  });

  it("shows a clear button only when the log is non-empty and clears on click", () => {
    hooked.clearChat.mockClear();
    hooked.entries = [];
    const empty = render(<CanvasAgentChat tab={tab} />);
    expect(empty.queryByLabelText("Clear conversation")).toBeNull();
    empty.unmount();

    hooked.entries = [{ id: "u1", role: "user", text: "hi" }];
    const filled = render(<CanvasAgentChat tab={tab} />);
    const clear = filled.getByLabelText("Clear conversation");
    fireEvent.click(clear);
    expect(hooked.clearChat).toHaveBeenCalledTimes(1);
  });
});
