import { describe, it, expect, beforeEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { SnackbarHost } from ".";
import { useSnackbarStore } from "../../hooks/snackbarStore";

beforeEach(() => {
  useSnackbarStore.setState({ snackbars: [] });
});

describe("SnackbarHost", () => {
  it("renders nothing when there are no snackbars", () => {
    const { container } = render(<SnackbarHost />);
    expect(container.firstChild).toBeNull();
  });

  it("renders queued snackbars with their messages", () => {
    useSnackbarStore.getState().enqueue("Fetch: Already up to date", "success");
    useSnackbarStore.getState().enqueue("Push: rejected", "error");
    render(<SnackbarHost />);
    expect(screen.getByText("Fetch: Already up to date")).toBeTruthy();
    expect(screen.getByText("Push: rejected")).toBeTruthy();
    expect(screen.getByTestId("snackbar-success")).toBeTruthy();
    expect(screen.getByTestId("snackbar-error")).toBeTruthy();
  });

  it("close button dismisses its snackbar", () => {
    const id = useSnackbarStore.getState().enqueue("Pull: failed", "error");
    render(<SnackbarHost />);
    fireEvent.click(screen.getByTestId(`snackbar-close-${id}`));
    expect(useSnackbarStore.getState().snackbars).toHaveLength(0);
    expect(screen.queryByText("Pull: failed")).toBeNull();
  });
});
