import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MessageStream } from "./index";
import { SHARE_NO_CONNECTION_HINT } from "../../constants";
import type { ChatItem } from "../../types";

// jsdom has no layout engine, so MessageStream's auto-scroll effect would throw.
HTMLElement.prototype.scrollIntoView = vi.fn();

const sqlItem: ChatItem = { id: "1", kind: "sql", sql: "SELECT 1" };

const noop = () => {};

const renderStream = (canShare: boolean, onPickConnection = noop) =>
  render(
    <MessageStream
      items={[sqlItem]}
      streaming={false}
      canShare={canShare}
      connectionOptions={[
        { value: "conn-a", label: "Prod" },
        { value: "conn-b", label: "Staging" },
      ]}
      onStop={noop}
      onInsert={noop}
      onReplace={noop}
      onShareResults={noop}
      onPickConnection={onPickConnection}
    />,
  );

describe("AgentPane SqlBlock share affordances", () => {
  it("shows Run & share buttons when a connection is active", () => {
    const { getByText, queryByText } = renderStream(true);
    expect(getByText("Run & share 100 rows")).toBeTruthy();
    expect(getByText("Run & share full results")).toBeTruthy();
    expect(queryByText(SHARE_NO_CONNECTION_HINT)).toBeNull();
  });

  it("prompts to select a connection when there is none", () => {
    const { getByText, queryByText } = renderStream(false);
    expect(getByText(SHARE_NO_CONNECTION_HINT, { exact: false })).toBeTruthy();
    // The share buttons are replaced by the picker, not shown alongside it.
    expect(queryByText("Run & share 100 rows")).toBeNull();
    expect(getByText("Choose connection")).toBeTruthy();
  });

  it("calls onPickConnection with the chosen connection id", () => {
    const onPick = vi.fn();
    const { getByText } = renderStream(false, onPick);
    // Open the picker, then choose a connection.
    fireEvent.click(getByText("Choose connection"));
    fireEvent.click(getByText("Staging"));
    expect(onPick).toHaveBeenCalledWith("conn-b");
  });
});
