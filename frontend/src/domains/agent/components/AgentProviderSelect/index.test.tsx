import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@domains/agent/components/AgentPane/ipc", () => ({
  checkAgentIPC: vi.fn().mockResolvedValue({ available: true, model: "test-model" }),
  sendAgentMessageIPC: vi.fn(),
  cancelAgentIPC: vi.fn(),
}));

import { useAgentStore } from "../../hooks/store";
import { AgentProviderSelect } from "./index";

describe("AgentProviderSelect", () => {
  beforeEach(() => {
    useAgentStore.setState({ model: null, available: null });
    vi.clearAllMocks();
  });

  it("renders the provider picker", () => {
    render(<AgentProviderSelect />);
    expect(screen.getByTestId("agent-provider-select")).toBeTruthy();
  });

  it("checks the active provider on mount and shows the resolved model", async () => {
    render(<AgentProviderSelect />);
    await waitFor(() => expect(screen.getByText("test-model")).toBeTruthy());
    expect(useAgentStore.getState().available).toBe(true);
  });
});
