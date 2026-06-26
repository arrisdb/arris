import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Plugin-dialog only resolves inside the Tauri runtime; stub the picker so
// FileTreeView can render in jsdom without exploding.
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

const mockInvoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { FileTreeView } from "./index";
import { useFileStatusMap } from "./hooks";
import { useFilesStore } from "../../hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import { useGitStore } from "@domains/git/hooks";
import type { FileTreeEntry } from "./types";

function inlineStyleValues(el: HTMLElement): string[] {
  return Array.from(el.style).map((name) => el.style.getPropertyValue(name).trim());
}

function makeTree(): FileTreeEntry {
  return {
    name: "sample_dbt_project",
    path: "/proj",
    isDir: true,
    children: [
      {
        name: "models",
        path: "/proj/models",
        isDir: true,
        children: [
          {
            name: "stg_customers.sql",
            path: "/proj/models/stg_customers.sql",
            isDir: false,
            children: [],
          },
        ],
      },
      {
        name: "dbt_project.yml",
        path: "/proj/dbt_project.yml",
        isDir: false,
        children: [],
      },
    ],
  };
}

beforeEach(() => {
  mockInvoke.mockImplementation((command: string) => {
    if (command === "cmd_read_text_file") return Promise.resolve("file contents");
    if (command === "cmd_duplicate_entry") return Promise.resolve("/proj/dbt_project copy.yml");
    if (command === "cmd_list_folder_tree") return Promise.resolve(null);
    return Promise.resolve(undefined);
  });
  useFilesStore.setState({
    rootPath: null,
    tree: null,
    isLoading: false,
    loadError: null,
    expanded: new Set<string>(),
    selectedPath: null,
    clipboardPath: null,
    clipboardOp: null,
    renamingPath: null,
  });
  useTabsStore.setState({
    tabs: [],
    layout: null,
    focusedPaneGroupId: null,
    activeId: null,
  });
  useGitStore.setState({
    repoPath: null,
    fileStatuses: [],
    branches: [],
    currentBranch: null,
    isPickerOpen: false,
    isLoading: false,
    loadError: null,
  });
  vi.clearAllMocks();
});

describe("FileTreeView empty state", () => {
  it("renders the 'Open a file' prompt with File + Folder buttons", () => {
    render(<FileTreeView />);
    const empty = screen.getByTestId("file-tree-empty");
    expect(empty.textContent).toContain("Open a file");
    expect(empty.textContent).not.toContain("Drop a folder");
    expect(screen.getByTestId("file-tree-open-file")).toBeTruthy();
    expect(screen.getByTestId("file-tree-open-folder")).toBeTruthy();
  });

  it("shows an empty-state context menu with open actions", () => {
    render(<FileTreeView />);
    fireEvent.contextMenu(screen.getByTestId("file-tree-empty"));

    const menu = screen.getByTestId("file-tree-ctx-menu");
    expect(menu.textContent).toContain("Open File");
    expect(menu.textContent).toContain("Open Folder");
  });
});

describe("FileTreeView single click", () => {
  it("renders the opened folder as the top-level row", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });

    render(<FileTreeView />);
    const rootRow = screen.getByTestId("file-tree-row-/proj");
    expect(rootRow.textContent).toContain("sample_dbt_project");
    expect(rootRow.querySelectorAll(".mdbc-indent-guide").length).toBe(0);
  });

  it("collapses the entire file tree from the top-level row", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj", "/proj/models"]),
    });

    render(<FileTreeView />);
    const rootRow = screen.getByTestId("file-tree-row-/proj");
    fireEvent.click(rootRow);

    expect(useFilesStore.getState().expanded.has("/proj")).toBe(false);
    expect(screen.queryByTestId("file-tree-row-/proj/models")).toBeNull();
    expect(screen.queryByTestId("file-tree-row-/proj/dbt_project.yml")).toBeNull();
  });

  it("opens file tab on single click for file rows", async () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });

    render(<FileTreeView />);
    const row = screen.getByTestId("file-tree-row-/proj/dbt_project.yml");
    fireEvent.click(row);

    await waitFor(() => {
      expect(useTabsStore.getState().tabs.length).toBe(1);
    });
    const tab = useTabsStore.getState().tabs[0];
    expect(tab.filePath).toBe("/proj/dbt_project.yml");
    expect(tab.title).toBe("dbt_project.yml");
    expect(useFilesStore.getState().selectedPath).toBe(
      "/proj/dbt_project.yml",
    );
  });

  it("highlights file row only when it is the active tab, not merely clicked", async () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });
    render(<FileTreeView />);
    const row = screen.getByTestId("file-tree-row-/proj/dbt_project.yml");
    // Click the file, opens a tab.
    fireEvent.click(row);
    await waitFor(() => {
      expect(useTabsStore.getState().tabs.length).toBe(1);
    });
    // Active tab has filePath matching the row → selected class present.
    expect(row.classList.contains("selected")).toBe(true);

    // Switch active tab to something else → row loses highlight.
    useTabsStore.setState({ activeId: null });
    render(<FileTreeView />);
    const rowAfter = screen.getAllByTestId("file-tree-row-/proj/dbt_project.yml")[0];
    expect(rowAfter.classList.contains("selected")).toBe(false);
  });

  it("toggles expansion for directory rows on single click without opening tab", async () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });

    render(<FileTreeView />);
    const row = screen.getByTestId("file-tree-row-/proj/models");
    fireEvent.click(row);

    expect(useFilesStore.getState().expanded.has("/proj/models")).toBe(true);
    expect(useTabsStore.getState().tabs.length).toBe(0);

    fireEvent.click(row);
    expect(useFilesStore.getState().expanded.has("/proj/models")).toBe(false);
  });
});

describe("FileTreeView context menu", () => {
  it("shows context menu with New File and New Folder on empty space right-click", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });

    render(<FileTreeView />);
    const container = screen.getByTestId("file-tree-container");
    fireEvent.contextMenu(container);

    const menu = screen.getByTestId("file-tree-ctx-menu");
    expect(menu.textContent).toContain("New File");
    expect(menu.textContent).toContain("New Folder");
  });

  it("shows full context menu on file row right-click", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });

    render(<FileTreeView />);
    const row = screen.getByTestId("file-tree-row-/proj/dbt_project.yml");
    fireEvent.contextMenu(row);

    const menu = screen.getByTestId("file-tree-ctx-menu");
    expect(menu.textContent).toContain("Cut");
    expect(menu.textContent).toContain("Copy");
    expect(menu.textContent).toContain("Duplicate");
    expect(menu.textContent).toContain("Paste");
    expect(menu.textContent).toContain("Rename");
    expect(menu.textContent).toContain("Delete");
  });

  it("context menu closes on outside click", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });

    render(<FileTreeView />);
    const container = screen.getByTestId("file-tree-container");
    fireEvent.contextMenu(container);
    expect(screen.getByTestId("file-tree-ctx-menu")).toBeTruthy();

    fireEvent.click(document.body);
    expect(screen.queryByTestId("file-tree-ctx-menu")).toBeNull();
  });

  it("Cut action sets clipboard state to cut", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });

    render(<FileTreeView />);
    const row = screen.getByTestId("file-tree-row-/proj/dbt_project.yml");
    fireEvent.contextMenu(row);

    const cutBtn = screen.getByText("Cut");
    fireEvent.click(cutBtn);

    expect(useFilesStore.getState().clipboardPath).toBe("/proj/dbt_project.yml");
    expect(useFilesStore.getState().clipboardOp).toBe("cut");
  });

  it("Copy action sets clipboard state to copy", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });

    render(<FileTreeView />);
    const row = screen.getByTestId("file-tree-row-/proj/dbt_project.yml");
    fireEvent.contextMenu(row);

    const copyBtn = screen.getByText("Copy");
    fireEvent.click(copyBtn);

    expect(useFilesStore.getState().clipboardPath).toBe("/proj/dbt_project.yml");
    expect(useFilesStore.getState().clipboardOp).toBe("copy");
  });

  it("Rename action sets renamingPath and shows inline input", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });

    render(<FileTreeView />);
    const row = screen.getByTestId("file-tree-row-/proj/dbt_project.yml");
    fireEvent.contextMenu(row);

    const renameBtn = screen.getByText("Rename");
    fireEvent.click(renameBtn);

    expect(useFilesStore.getState().renamingPath).toBe("/proj/dbt_project.yml");
    expect(screen.getByTestId("inline-rename-input")).toBeTruthy();
  });
});

describe("FileTreeView git status colors", () => {
  it("colors filename yellow for modified files", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });
    useGitStore.setState({
      repoPath: "/proj",
      fileStatuses: [{ path: "/proj/dbt_project.yml", status: "M", indexStatus: " ", worktreeStatus: "M" }],
    });

    render(<FileTreeView />);
    const row = screen.getByTestId("file-tree-row-/proj/dbt_project.yml");
    const name = row.querySelector(".mdbc-file-name") as HTMLElement;
    expect(name).toBeTruthy();
    expect(inlineStyleValues(name)).toContain("rgba(255,217,96,0.85)");
  });

  it("colors filename green for added files", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj", "/proj/models"]),
    });
    useGitStore.setState({
      repoPath: "/proj",
      fileStatuses: [
        { path: "/proj/models/stg_customers.sql", status: "A", indexStatus: "A", worktreeStatus: " " },
      ],
    });

    render(<FileTreeView />);
    const row = screen.getByTestId(
      "file-tree-row-/proj/models/stg_customers.sql",
    );
    const name = row.querySelector(".mdbc-file-name") as HTMLElement;
    expect(name).toBeTruthy();
    expect(inlineStyleValues(name)).toContain("rgba(91,227,154,0.85)");
  });

  it("propagates status color to parent directories", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });
    useGitStore.setState({
      repoPath: "/proj",
      fileStatuses: [
        { path: "/proj/models/stg_customers.sql", status: "M", indexStatus: " ", worktreeStatus: "M" },
      ],
    });

    render(<FileTreeView />);
    const dirRow = screen.getByTestId("file-tree-row-/proj/models");
    const name = dirRow.querySelector(".mdbc-file-name") as HTMLElement;
    expect(name).toBeTruthy();
    expect(inlineStyleValues(name)).toContain("rgba(255,217,96,0.85)");
  });

  it("does not color filename for untracked files (?)", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });
    useGitStore.setState({
      repoPath: "/proj",
      fileStatuses: [{ path: "/proj/dbt_project.yml", status: "?", indexStatus: "?", worktreeStatus: "?" }],
    });

    render(<FileTreeView />);
    const row = screen.getByTestId("file-tree-row-/proj/dbt_project.yml");
    const name = row.querySelector(".mdbc-file-name") as HTMLElement;
    expect(name).toBeTruthy();
    expect(name.style.color).toBe("");
  });
});

describe("FileTreeView gitIgnored styling", () => {
  it("applies reduced opacity for gitIgnored files", () => {
    const tree: FileTreeEntry = {
      name: "root",
      path: "/proj",
      isDir: true,
      children: [
        {
          name: "tracked.sql",
          path: "/proj/tracked.sql",
          isDir: false,
          children: [],
        },
        {
          name: "ignored.log",
          path: "/proj/ignored.log",
          isDir: false,
          gitIgnored: true,
          children: [],
        },
      ],
    };
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });

    render(<FileTreeView />);
    const trackedRow = screen.getByTestId("file-tree-row-/proj/tracked.sql");
    const ignoredRow = screen.getByTestId("file-tree-row-/proj/ignored.log");
    expect(inlineStyleValues(trackedRow)).not.toContain("0.45");
    expect(inlineStyleValues(ignoredRow)).toContain("0.45");
  });

  it("applies reduced opacity to gitIgnored directories and children", () => {
    const tree: FileTreeEntry = {
      name: "root",
      path: "/proj",
      isDir: true,
      children: [
        {
          name: "build",
          path: "/proj/build",
          isDir: true,
          gitIgnored: true,
          children: [
            {
              name: "out.js",
              path: "/proj/build/out.js",
              isDir: false,
              gitIgnored: true,
              children: [],
            },
          ],
        },
      ],
    };
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj", "/proj/build"]),
    });

    render(<FileTreeView />);
    const dirRow = screen.getByTestId("file-tree-row-/proj/build");
    const childRow = screen.getByTestId("file-tree-row-/proj/build/out.js");
    expect(inlineStyleValues(dirRow)).toContain("0.45");
    expect(inlineStyleValues(childRow)).toContain("0.45");
  });
});

describe("FileTreeView indent guides", () => {
  it("renders no indent guides for the top-level folder row", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });

    render(<FileTreeView />);
    const row = screen.getByTestId("file-tree-row-/proj");
    const guides = row.querySelectorAll(".mdbc-indent-guide");
    expect(guides.length).toBe(0);
  });

  it("renders one indent guide per depth level for nested rows", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj", "/proj/models"]),
    });

    render(<FileTreeView />);
    const dirRow = screen.getByTestId("file-tree-row-/proj/models");
    expect(dirRow.querySelectorAll(".mdbc-indent-guide").length).toBe(1);

    const fileRow = screen.getByTestId("file-tree-row-/proj/models/stg_customers.sql");
    expect(fileRow.querySelectorAll(".mdbc-indent-guide").length).toBe(2);
  });

  it("does not render any chevron elements", () => {
    const tree = makeTree();
    useFilesStore.setState({
      rootPath: "/proj",
      tree,
      expanded: new Set<string>(["/proj"]),
    });

    render(<FileTreeView />);
    const container = screen.getByTestId("file-tree-container");
    expect(container.querySelectorAll(".mdbc-file-chevron").length).toBe(0);
  });
});

describe("useFileStatusMap", () => {
  function StatusMapReader({ onMap }: { onMap: (m: Map<string, string>) => void }) {
    const map = useFileStatusMap();
    onMap(map);
    return null;
  }

  it("returns empty map when no statuses", () => {
    let capturedMap = new Map<string, string>();
    render(<StatusMapReader onMap={(m) => { capturedMap = m; }} />);
    expect(capturedMap.size).toBe(0);
  });

  it("builds map with absolute paths and propagates to parents", () => {
    useGitStore.setState({
      repoPath: "/repo",
      fileStatuses: [
        { path: "/repo/src/foo.ts", status: "M", indexStatus: " ", worktreeStatus: "M" },
        { path: "/repo/src/bar.ts", status: "A", indexStatus: "A", worktreeStatus: " " },
      ],
    });

    let capturedMap = new Map<string, string>();
    render(<StatusMapReader onMap={(m) => { capturedMap = m; }} />);

    expect(capturedMap.get("/repo/src/foo.ts")).toBe("M");
    expect(capturedMap.get("/repo/src/bar.ts")).toBe("A");
    expect(capturedMap.get("/repo/src")).toBe("M");
  });

  it("propagates a deleted file's red status up over modified siblings", () => {
    useGitStore.setState({
      repoPath: "/repo",
      fileStatuses: [
        { path: "/repo/marts/dim_customers.sql", status: "M", indexStatus: " ", worktreeStatus: "M" },
        { path: "/repo/marts/new_model.sql", status: "D", indexStatus: " ", worktreeStatus: "D" },
      ],
    });

    let capturedMap = new Map<string, string>();
    render(<StatusMapReader onMap={(m) => { capturedMap = m; }} />);

    // Deletion outranks modification → folder tints red.
    expect(capturedMap.get("/repo/marts")).toBe("D");
    expect(capturedMap.get("/repo")).toBe("D");
  });
});
