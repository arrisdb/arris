import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const checkForUpdateIPC = vi.fn();
const getAppVersionIPC = vi.fn();
const downloadAndInstallIPC = vi.fn();
const relaunchAppIPC = vi.fn();

vi.mock("./ipc", () => ({
  checkForUpdateIPC: () => checkForUpdateIPC(),
  getAppVersionIPC: () => getAppVersionIPC(),
  downloadAndInstallIPC: (...args: unknown[]) => downloadAndInstallIPC(...args),
  relaunchAppIPC: () => relaunchAppIPC(),
}));

import { UpdateButton } from ".";

describe("UpdateButton", () => {
  beforeEach(() => {
    checkForUpdateIPC.mockReset();
    getAppVersionIPC.mockReset();
    downloadAndInstallIPC.mockReset();
    relaunchAppIPC.mockReset();
    getAppVersionIPC.mockResolvedValue("1.2.0");
  });

  it("shows an idle 'Check for updates' button when no update is found on boot", async () => {
    checkForUpdateIPC.mockResolvedValue(null);
    render(<UpdateButton />);
    const btn = await screen.findByTestId("top-bar-update");
    await waitFor(() => expect(checkForUpdateIPC).toHaveBeenCalled());
    expect(btn.textContent).toContain("Check for updates");
  });

  it("auto-surfaces 'Update to vX' when the boot check finds an update", async () => {
    checkForUpdateIPC.mockResolvedValue({ version: "1.2.3", currentVersion: "1.2.0" });
    render(<UpdateButton />);
    const btn = await screen.findByTestId("top-bar-update");
    await waitFor(() => expect(btn.textContent).toContain("Update to v1.2.3"));
  });

  it("reports up-to-date with the running version on a manual check", async () => {
    checkForUpdateIPC.mockResolvedValue(null);
    render(<UpdateButton />);
    const btn = await screen.findByTestId("top-bar-update");
    await waitFor(() => expect(btn.textContent).toContain("Check for updates"));
    fireEvent.click(btn);
    await waitFor(() => expect(btn.textContent).toContain("v1.2.0 is up-to-date"));
  });

  it("flips a manual check to an actionable update when one appears", async () => {
    checkForUpdateIPC.mockResolvedValueOnce(null);
    render(<UpdateButton />);
    const btn = await screen.findByTestId("top-bar-update");
    await waitFor(() => expect(btn.textContent).toContain("Check for updates"));
    checkForUpdateIPC.mockResolvedValueOnce({ version: "2.0.0", currentVersion: "1.2.0" });
    fireEvent.click(btn);
    await waitFor(() => expect(btn.textContent).toContain("Update to v2.0.0"));
  });

  it("reverts the up-to-date confirmation back to 'Check for updates' after the delay", async () => {
    vi.useFakeTimers();
    try {
      checkForUpdateIPC.mockResolvedValue(null);
      render(<UpdateButton />);
      await vi.advanceTimersByTimeAsync(0);
      const btn = screen.getByTestId("top-bar-update");
      fireEvent.click(btn);
      await vi.advanceTimersByTimeAsync(0);
      expect(btn.textContent).toContain("up-to-date");
      await vi.advanceTimersByTimeAsync(5000);
      expect(btn.textContent).toContain("Check for updates");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays idle when the update check fails", async () => {
    checkForUpdateIPC.mockRejectedValue(new Error("offline"));
    render(<UpdateButton />);
    const btn = await screen.findByTestId("top-bar-update");
    await waitFor(() => expect(checkForUpdateIPC).toHaveBeenCalled());
    expect(btn.textContent).toContain("Check for updates");
  });
});
