import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { GitChangesPane } from "./index";
import { useGitStore } from "../../hooks";
import { useFilesStore } from "@domains/files/hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";

describe("GitChangesPane", () => {
  beforeEach(() => {
    useFilesStore.setState({ rootPath: "/repo" });
    useGitStore.getState().clear();
  });

  it("keeps the push button visible after a commit clears the working tree", () => {
    // Clean working tree (nothing to commit) but the branch has an upstream
    // and one un-pushed commit, so the push action must remain available.
    useGitStore.setState({
      fileStatuses: [],
      hasRemote: true,
      hasUpstream: true,
      aheadBehind: [1, 0],
    });

    render(<GitChangesPane />);

    expect(screen.getByRole("button", { name: /Push/ })).toBeTruthy();
  });

  it("keeps Push enabled when the branch is up to date (push is idempotent)", () => {
    useGitStore.setState({
      fileStatuses: [],
      hasRemote: true,
      hasUpstream: true,
      aheadBehind: [0, 0],
    });

    render(<GitChangesPane />);

    const push = screen.getByRole("button", { name: /Push/ }) as HTMLButtonElement;
    expect(push.disabled).toBe(false);
  });

  it("offers Publish Branch when there is a remote but no upstream yet", () => {
    useGitStore.setState({
      fileStatuses: [],
      hasRemote: true,
      hasUpstream: false,
      aheadBehind: [0, 0],
    });

    render(<GitChangesPane />);

    expect(screen.getByRole("button", { name: /Publish Branch/ })).toBeTruthy();
  });

  it("hides the push button when there is no remote", () => {
    useGitStore.setState({
      fileStatuses: [],
      hasRemote: false,
      hasUpstream: false,
      aheadBehind: [0, 0],
    });

    render(<GitChangesPane />);

    expect(screen.queryByRole("button", { name: /Push|Publish/ })).toBeNull();
  });

  it("renders the stage checkbox at the right edge, after the filename", () => {
    useGitStore.setState({
      fileStatuses: [
        {
          path: "/repo/models/stg_orders.sql",
          status: "M",
          indexStatus: " ",
          worktreeStatus: "M",
        },
      ],
      hasRemote: false,
      hasUpstream: false,
      aheadBehind: [0, 0],
    });

    render(<GitChangesPane />);

    const row = screen.getByTestId("git-file-stg_orders.sql");
    const checkbox = row.querySelector("input[type=checkbox]");
    const name = row.querySelector(".mdbc-file-name");
    expect(checkbox).toBeTruthy();
    expect(name).toBeTruthy();
    // Checkbox is the last child → it follows the filename in DOM order (right edge).
    expect(row.lastElementChild).toBe(checkbox);
    expect(
      name!.compareDocumentPosition(checkbox!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens a context menu with Unstage / Discard / Open on right-click", () => {
    useGitStore.setState({
      fileStatuses: [
        {
          path: "/repo/models/stg_orders.sql",
          status: "M",
          indexStatus: "M",
          worktreeStatus: " ",
        },
      ],
      hasRemote: false,
      hasUpstream: false,
      aheadBehind: [0, 0],
    });

    render(<GitChangesPane />);
    fireEvent.contextMenu(screen.getByTestId("git-file-stg_orders.sql"));

    const menu = screen.getByTestId("git-file-ctx-menu");
    // Staged (indexStatus "M") → the toggle reads "Unstage File".
    expect(within(menu).getByTestId("git-ctx-stage").textContent).toBe("Unstage File");
    expect(within(menu).getByTestId("git-ctx-discard")).toBeTruthy();
    expect(within(menu).getByTestId("git-ctx-open")).toBeTruthy();
  });

  it("disables Discard Changes for untracked files", () => {
    useGitStore.setState({
      fileStatuses: [
        {
          path: "/repo/new.txt",
          status: "?",
          indexStatus: "?",
          worktreeStatus: "?",
        },
      ],
      hasRemote: false,
      hasUpstream: false,
      aheadBehind: [0, 0],
    });

    render(<GitChangesPane />);
    fireEvent.contextMenu(screen.getByTestId("git-file-new.txt"));

    const discard = screen.getByTestId("git-ctx-discard") as HTMLButtonElement;
    expect(discard.disabled).toBe(true);
    // Untracked file is not staged → toggle offers "Stage File".
    expect(screen.getByTestId("git-ctx-stage").textContent).toBe("Stage File");
  });

  it("shows the repository-moved prompt with the new URL on a moved push error", () => {
    useGitStore.setState({
      fileStatuses: [],
      hasRemote: true,
      hasUpstream: true,
      aheadBehind: [1, 0],
      remotes: [{ name: "origin", url: "https://github.com/x/old.git" }],
      pushError:
        "git push failed: remote: This repository moved. Please use the new location:\n" +
        "remote:   https://github.com/x/new.git",
    });

    render(<GitChangesPane />);

    const banner = screen.getByTestId("git-remote-moved");
    expect(within(banner).getByText("https://github.com/x/new.git")).toBeTruthy();
    expect(screen.getByTestId("git-remote-moved-apply")).toBeTruthy();
  });

  it("styles Stage All / Unstage All with the shared mdbc-btn button", () => {
    useGitStore.setState({
      fileStatuses: [
        {
          path: "/repo/models/stg_orders.sql",
          status: "M",
          indexStatus: " ",
          worktreeStatus: "M",
        },
      ],
      hasRemote: false,
      hasUpstream: false,
      aheadBehind: [0, 0],
    });

    render(<GitChangesPane />);

    for (const label of ["Stage All", "Unstage All"]) {
      const btn = screen.getByRole("button", { name: label });
      // Standard bordered button, like Commit, not the borderless text-only one.
      expect(btn.classList.contains("mdbc-btn")).toBe(true);
      expect(btn.classList.contains("text-only")).toBe(false);
      // The old one-off class is gone.
      expect(btn.classList.contains("mdbc-git-action-small")).toBe(false);
    }
  });

  it("places the Publish Branch / Push split button at the left of the commit row, before Commit", () => {
    useGitStore.setState({
      fileStatuses: [],
      hasRemote: true,
      hasUpstream: false,
      aheadBehind: [0, 0],
    });

    const { container } = render(<GitChangesPane />);

    const commitRow = container.querySelector(".mdbc-git-commit-row");
    expect(commitRow).toBeTruthy();
    const commitBtn = within(commitRow as HTMLElement).getByRole("button", { name: /Commit/ });
    const actions = within(commitRow as HTMLElement).getByTestId("git-actions");
    // The split button sits at the left end, before Commit in DOM order.
    expect(actions).toBeTruthy();
    expect(
      actions.compareDocumentPosition(commitBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(actions).getByRole("button", { name: /Publish Branch/ })).toBeTruthy();
    // It no longer sits up in the branch-meta row.
    const meta = container.querySelector(".mdbc-pane-meta");
    expect(meta?.querySelector("[data-testid='git-actions']")).toBeNull();
  });

  it("opens the Uncommitted Changes diff tab when a changed file is clicked", () => {
    useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
    useGitStore.setState({
      fileStatuses: [
        {
          path: "/repo/models/stg_orders.sql",
          status: "M",
          indexStatus: " ",
          worktreeStatus: "M",
        },
      ],
      hasRemote: false,
      hasUpstream: false,
      aheadBehind: [0, 0],
    });

    render(<GitChangesPane />);
    // No diff tab yet.
    expect(useTabsStore.getState().tabs.some((t) => t.tabType === "gitdiff")).toBe(false);

    fireEvent.click(screen.getByTestId("git-file-stg_orders.sql"));

    // Clicking the file selects it AND surfaces the diff tab.
    expect(useGitStore.getState().selectedFile).toBe("/repo/models/stg_orders.sql");
    expect(useTabsStore.getState().tabs.some((t) => t.tabType === "gitdiff")).toBe(true);
  });

  it("reveals the remotes editor with each remote's URL when toggled", () => {
    useGitStore.setState({
      fileStatuses: [],
      hasRemote: true,
      hasUpstream: true,
      aheadBehind: [0, 0],
      remotes: [{ name: "origin", url: "https://github.com/x/old.git" }],
    });

    render(<GitChangesPane />);
    expect(screen.queryByTestId("git-remotes-editor")).toBeNull();

    fireEvent.click(screen.getByTestId("git-remotes-toggle"));

    const input = screen.getByTestId("git-remote-input-origin") as HTMLInputElement;
    expect(input.value).toBe("https://github.com/x/old.git");
    // No Save button / indicator: the URL input commits on blur/Enter.
    expect(screen.queryByTestId("git-remote-save-origin")).toBeNull();
    expect(screen.queryByTestId("git-remote-saved-origin")).toBeNull();

    fireEvent.change(input, { target: { value: "https://github.com/x/new.git" } });
    expect(input.value).toBe("https://github.com/x/new.git");
  });
});
