import { afterEach, describe, expect, it, vi } from "vitest";
import {
  basenameOf,
  clearFileTreeDragGhost,
  copyExternalFilesIntoFileTree,
  fileContextMenuItems,
  fileKindForName,
  fileTreeDropTargetDirAt,
  findAllProjectRoots,
  gitStatusColor,
  isInvalidMoveTarget,
  openFileInTab,
  moveEntryIntoTreeDir,
  moveFileTreeDragGhost,
  pasteIntoTree,
  pasteTargetDirForSelectedPath,
  resolveDropTargetDir,
  showFileTreeDragGhost,
  statusPriority,
} from "./utils";
import { useFilesStore } from "../../hooks";
import { useTabsStore } from "@shell/hooks/tabsStore";
import type { FileTreeEntry } from "./types";

const copyEntry = vi.fn((..._args: string[]) => Promise.resolve());
const moveEntry = vi.fn((..._args: string[]) => Promise.resolve());
const readClipboardFiles = vi.fn<() => Promise<string[]>>(() => Promise.resolve([]));
vi.mock("./ipc", () => ({
  fileTreeViewCopyEntryIPC: (from: string, to: string) => copyEntry(from, to),
  fileTreeViewDeleteEntryIPC: vi.fn(),
  fileTreeViewDuplicateEntryIPC: vi.fn(),
  fileTreeViewListFolderTreeIPC: vi.fn(),
  fileTreeViewMoveEntryIPC: (from: string, to: string) => moveEntry(from, to),
  fileTreeViewReadClipboardFilePathsIPC: () => readClipboardFiles(),
  fileTreeViewReadTextFileIPC: vi.fn(),
  fileTreeViewCreateFileIPC: vi.fn(),
  fileTreeViewCreateFolderIPC: vi.fn(),
  fileTreeViewRenameEntryIPC: vi.fn(),
}));

function dir(name: string, path: string, children: FileTreeEntry[]): FileTreeEntry {
  return { name, path, isDir: true, children } as FileTreeEntry;
}

function file(name: string, path: string): FileTreeEntry {
  return { name, path, isDir: false, children: [] } as FileTreeEntry;
}

describe("fileKindForName", () => {
  it("maps known extensions to editor kinds", () => {
    expect(fileKindForName("dim_users.sql")).toBe("sql");
    expect(fileKindForName("schema.yml")).toBe("yaml");
    expect(fileKindForName("schema.YAML")).toBe("yaml");
    expect(fileKindForName("manifest.json")).toBe("json");
    expect(fileKindForName("README.md")).toBe("markdown");
    expect(fileKindForName("script.py")).toBe("python");
    expect(fileKindForName("build.sh")).toBe("bash");
    expect(fileKindForName("index.html")).toBe("html");
    expect(fileKindForName("page.HTM")).toBe("html");
    expect(fileKindForName("data.xml")).toBe("xml");
    expect(fileKindForName("transform.xsl")).toBe("xml");
    expect(fileKindForName("schema.xsd")).toBe("xml");
    expect(fileKindForName("Cargo.toml")).toBe("toml");
  });

  it("maps .lock files to toml so Cargo.lock/uv.lock get TOML highlighting", () => {
    expect(fileKindForName("Cargo.lock")).toBe("toml");
    expect(fileKindForName("uv.lock")).toBe("toml");
    expect(fileKindForName("poetry.lock")).toBe("toml");
  });

  it("maps Makefile to shell and falls back to text for unknown extensions", () => {
    expect(fileKindForName("Makefile")).toBe("shell");
    expect(fileKindForName("notes.unknownext")).toBe("text");
  });
});

describe("basenameOf", () => {
  it("returns the last non-empty segment", () => {
    expect(basenameOf("/Users/x/Projects/arris")).toBe("arris");
    expect(basenameOf("/Users/x/Projects/arris/")).toBe("arris");
    expect(basenameOf("README.md")).toBe("README.md");
  });
});

describe("resolveDropTargetDir", () => {
  it("returns the folder itself when dropping onto a directory", () => {
    expect(resolveDropTargetDir("/ws/models", true)).toBe("/ws/models");
  });

  it("returns the parent directory when dropping onto a file", () => {
    expect(resolveDropTargetDir("/ws/models/stg.sql", false)).toBe("/ws/models");
  });
});

describe("file-tree external drop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    copyEntry.mockClear();
  });

  it("targets the folder row under the cursor", () => {
    const row = document.createElement("button");
    row.setAttribute("data-tree-row", "");
    row.dataset.path = "/ws/models";
    row.dataset.isdir = "true";
    document.elementFromPoint = vi.fn(() => row) as never;
    expect(fileTreeDropTargetDirAt(5, 5)).toBe("/ws/models");
  });

  it("targets a file row's parent directory", () => {
    const row = document.createElement("button");
    row.setAttribute("data-tree-row", "");
    row.dataset.path = "/ws/models/stg.sql";
    row.dataset.isdir = "false";
    document.elementFromPoint = vi.fn(() => row) as never;
    expect(fileTreeDropTargetDirAt(5, 5)).toBe("/ws/models");
  });

  it("falls back to the project root for empty space inside the tree pane", () => {
    const pane = document.createElement("div");
    pane.className = "mdbc-file-tree";
    const inner = document.createElement("div");
    pane.appendChild(inner);
    document.body.appendChild(pane);
    document.elementFromPoint = vi.fn(() => inner) as never;
    vi.spyOn(useFilesStore, "getState").mockReturnValue({ rootPath: "/ws" } as never);
    expect(fileTreeDropTargetDirAt(5, 5)).toBe("/ws");
  });

  it("returns null when the point is outside the tree", () => {
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    document.elementFromPoint = vi.fn(() => outside) as never;
    expect(fileTreeDropTargetDirAt(5, 5)).toBeNull();
  });

  it("copies each dropped path into the target dir, then reveals + refreshes it", async () => {
    const setExpanded = vi.fn();
    const refresh = vi.fn(() => Promise.resolve());
    vi.spyOn(useFilesStore, "getState").mockReturnValue({ setExpanded, refresh } as never);
    await copyExternalFilesIntoFileTree(["/Downloads/a.png", "/Downloads/b.svg"], "/ws/assets");
    expect(copyEntry).toHaveBeenNthCalledWith(1, "/Downloads/a.png", "/ws/assets/a.png");
    expect(copyEntry).toHaveBeenNthCalledWith(2, "/Downloads/b.svg", "/ws/assets/b.svg");
    expect(setExpanded).toHaveBeenCalledWith("/ws/assets", true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("paste into tree", () => {
  const tree = dir("ws", "/ws", [
    dir("assets", "/ws/assets", [file("logo.png", "/ws/assets/logo.png")]),
  ]);

  afterEach(() => {
    vi.restoreAllMocks();
    copyEntry.mockClear();
    readClipboardFiles.mockReset();
    readClipboardFiles.mockResolvedValue([]);
  });

  it("resolves a selected folder to itself and a selected file to its parent", () => {
    vi.spyOn(useFilesStore, "getState").mockReturnValue({ tree } as never);
    expect(pasteTargetDirForSelectedPath("/ws/assets")).toBe("/ws/assets");
    expect(pasteTargetDirForSelectedPath("/ws/assets/logo.png")).toBe("/ws/assets");
  });

  it("prefers OS clipboard files, copying them into the selected folder", async () => {
    readClipboardFiles.mockResolvedValue(["/Downloads/pic.png"]);
    const setExpanded = vi.fn();
    const refresh = vi.fn(() => Promise.resolve());
    vi.spyOn(useFilesStore, "getState").mockReturnValue({ tree, setExpanded, refresh } as never);
    await pasteIntoTree("/ws/assets");
    expect(copyEntry).toHaveBeenCalledWith("/Downloads/pic.png", "/ws/assets/pic.png");
  });

  it("falls back to the in-app clipboard when the OS clipboard has no files", async () => {
    readClipboardFiles.mockResolvedValue([]);
    // No internal clipboard set -> handlePaste early-returns, nothing copied.
    vi.spyOn(useFilesStore, "getState").mockReturnValue({ clipboardPath: null, clipboardOp: null } as never);
    await pasteIntoTree("/ws/assets");
    expect(copyEntry).not.toHaveBeenCalled();
  });
});

describe("internal move (drag within tree)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    moveEntry.mockClear();
  });

  it("flags no-op and invalid destinations", () => {
    // Same parent → no-op.
    expect(isInvalidMoveTarget("/ws/a/file.sql", "/ws/a")).toBe(true);
    // Into itself.
    expect(isInvalidMoveTarget("/ws/a", "/ws/a")).toBe(true);
    // Into its own descendant.
    expect(isInvalidMoveTarget("/ws/a", "/ws/a/sub")).toBe(true);
    // Into a different sibling folder → valid.
    expect(isInvalidMoveTarget("/ws/a/file.sql", "/ws/b")).toBe(false);
  });

  it("moves an entry into the destination dir, then reveals + refreshes", async () => {
    const setExpanded = vi.fn();
    const refresh = vi.fn(() => Promise.resolve());
    const selectPath = vi.fn();
    vi.spyOn(useFilesStore, "getState").mockReturnValue({ setExpanded, refresh, selectPath } as never);
    await moveEntryIntoTreeDir("/ws/a/file.sql", "/ws/b");
    expect(moveEntry).toHaveBeenCalledWith("/ws/a/file.sql", "/ws/b/file.sql");
    expect(setExpanded).toHaveBeenCalledWith("/ws/b", true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(selectPath).toHaveBeenCalledWith("/ws/b/file.sql");
  });

  it("skips the move when the destination is invalid", async () => {
    await moveEntryIntoTreeDir("/ws/a/file.sql", "/ws/a");
    expect(moveEntry).not.toHaveBeenCalled();
  });
});

describe("drag ghost (visual follow-cursor label)", () => {
  afterEach(() => {
    clearFileTreeDragGhost();
  });

  function ghost(): HTMLElement | null {
    return document.querySelector(".mdbc-file-drag-ghost");
  }

  it("creates a single positioned label and updates it on move", () => {
    showFileTreeDragGhost("file.sql", 100, 200);
    const el = ghost();
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("file.sql");
    // Sits beside the cursor (offset applied), not under it.
    expect(el!.style.left).toBe("112px");
    expect(el!.style.top).toBe("212px");

    // Second show reuses the same element (no duplicates).
    showFileTreeDragGhost("file.sql", 50, 60);
    expect(document.querySelectorAll(".mdbc-file-drag-ghost")).toHaveLength(1);

    moveFileTreeDragGhost(300, 400);
    expect(el!.style.left).toBe("312px");
    expect(el!.style.top).toBe("412px");
  });

  it("removes the ghost on clear", () => {
    showFileTreeDragGhost("file.sql", 10, 10);
    expect(ghost()).not.toBeNull();
    clearFileTreeDragGhost();
    expect(ghost()).toBeNull();
  });

  it("moveFileTreeDragGhost is a no-op when no ghost exists", () => {
    expect(() => moveFileTreeDragGhost(1, 2)).not.toThrow();
    expect(ghost()).toBeNull();
  });
});

describe("context menu Paste enablement", () => {
  function pasteDisabled(opts: { hasClipboard: boolean; hasOsFiles: boolean }): boolean | undefined {
    const node = file("logo.png", "/ws/logo.png");
    const items = fileContextMenuItems({
      node,
      rootPath: "/ws",
      hasClipboard: opts.hasClipboard,
      hasOsFiles: opts.hasOsFiles,
      hasTree: true,
      onOpenFile: () => {},
      onOpenFolder: () => {},
    });
    const paste = items.find((item) => "id" in item && item.id === "paste");
    return paste && "disabled" in paste ? paste.disabled : undefined;
  }

  it("disables Paste only when neither the in-app nor the OS clipboard has anything", () => {
    expect(pasteDisabled({ hasClipboard: false, hasOsFiles: false })).toBe(true);
    expect(pasteDisabled({ hasClipboard: true, hasOsFiles: false })).toBe(false);
    expect(pasteDisabled({ hasClipboard: false, hasOsFiles: true })).toBe(false);
  });
});

describe("context menu Move to Scratch", () => {
  function moveToScratchItem(path: string) {
    const items = fileContextMenuItems({
      node: file(path.split("/").pop() ?? path, path),
      rootPath: "/ws",
      hasClipboard: false,
      hasOsFiles: false,
      hasTree: true,
      onOpenFile: () => {},
      onOpenFolder: () => {},
    });
    return items.find((item) => "id" in item && item.id === "move-to-scratch");
  }

  afterEach(() => {
    useTabsStore.setState({ tabs: [] });
  });

  it("offers Move to Scratch only for a file bound to a console/notebook tab", () => {
    useTabsStore.setState({
      tabs: [
        { id: "t1", title: "report.sql", text: "", kind: "sql", cursor: 0, tabType: "console", filePath: "/ws/report.sql" },
      ] as never,
    });
    expect(moveToScratchItem("/ws/report.sql")).toBeTruthy();
  });

  it("does not offer Move to Scratch for an ordinary file", () => {
    useTabsStore.setState({ tabs: [] });
    expect(moveToScratchItem("/ws/notes.txt")).toBeUndefined();
  });

  it("does not offer Move to Scratch for a plain file editor tab", () => {
    useTabsStore.setState({
      tabs: [
        { id: "t2", title: "notes.txt", text: "", kind: "text", cursor: 0, tabType: "file", filePath: "/ws/notes.txt" },
      ] as never,
    });
    expect(moveToScratchItem("/ws/notes.txt")).toBeUndefined();
  });
});

describe("findAllProjectRoots", () => {
  const DBT = ["dbt_project.yml"];
  const SQLMESH = ["config.yaml", "config.yml"];

  it("finds every dbt project root in a multi-project workspace", () => {
    const tree = dir("ws", "/ws", [
      dir("shop", "/ws/shop", [
        file("dbt_project.yml", "/ws/shop/dbt_project.yml"),
        dir("models", "/ws/shop/models", []),
      ]),
      dir("finance", "/ws/finance", [
        file("dbt_project.yml", "/ws/finance/dbt_project.yml"),
      ]),
      dir("docs", "/ws/docs", [file("readme.md", "/ws/docs/readme.md")]),
    ]);
    expect(findAllProjectRoots(tree, DBT)).toEqual(["/ws/finance", "/ws/shop"]);
  });

  it("does not descend into a found root (vendored dbt_packages are ignored)", () => {
    const tree = dir("ws", "/ws", [
      dir("shop", "/ws/shop", [
        file("dbt_project.yml", "/ws/shop/dbt_project.yml"),
        dir("dbt_packages", "/ws/shop/dbt_packages", [
          dir("utils", "/ws/shop/dbt_packages/utils", [
            file("dbt_project.yml", "/ws/shop/dbt_packages/utils/dbt_project.yml"),
          ]),
        ]),
      ]),
    ]);
    expect(findAllProjectRoots(tree, DBT)).toEqual(["/ws/shop"]);
  });

  it("matches markers case-insensitively and accepts either sqlmesh config name", () => {
    const tree = dir("ws", "/ws", [
      dir("a", "/ws/a", [file("config.yaml", "/ws/a/config.yaml")]),
      dir("b", "/ws/b", [file("Config.YML", "/ws/b/Config.YML")]),
    ]);
    expect(findAllProjectRoots(tree, SQLMESH)).toEqual(["/ws/a", "/ws/b"]);
  });

  it("returns an empty array when no project markers exist", () => {
    const tree = dir("ws", "/ws", [
      dir("src", "/ws/src", [file("main.ts", "/ws/src/main.ts")]),
    ]);
    expect(findAllProjectRoots(tree, DBT)).toEqual([]);
  });

  it("keeps dbt and sqlmesh discovery independent in a mixed workspace", () => {
    const tree = dir("ws", "/ws", [
      dir("warehouse", "/ws/warehouse", [
        file("dbt_project.yml", "/ws/warehouse/dbt_project.yml"),
      ]),
      dir("transform", "/ws/transform", [
        file("config.yaml", "/ws/transform/config.yaml"),
      ]),
    ]);
    expect(findAllProjectRoots(tree, DBT)).toEqual(["/ws/warehouse"]);
    expect(findAllProjectRoots(tree, SQLMESH)).toEqual(["/ws/transform"]);
  });
});

describe("gitStatusColor", () => {
  it("tints untracked and added files green, modified/renamed yellow", () => {
    const green = "rgba(91,227,154,0.85)";
    const yellow = "rgba(255,217,96,0.85)";
    expect(gitStatusColor("?")).toBe(green);
    expect(gitStatusColor("A")).toBe(green);
    expect(gitStatusColor("M")).toBe(yellow);
    expect(gitStatusColor("R")).toBe(yellow);
  });

  it("tints deleted content red so folders holding a deletion stand out", () => {
    expect(gitStatusColor("D")).toBe("rgba(255,107,107,0.85)");
  });

  it("returns no color for absent status", () => {
    expect(gitStatusColor(undefined)).toBeUndefined();
  });
});

describe("statusPriority", () => {
  it("ranks deleted above modified above new (added/untracked)", () => {
    expect(statusPriority("D")).toBeGreaterThan(statusPriority("M"));
    expect(statusPriority("M")).toBeGreaterThan(statusPriority("A"));
    expect(statusPriority("A")).toBe(statusPriority("?"));
    expect(statusPriority("?")).toBeGreaterThan(statusPriority("X"));
  });
});

describe("openFileInTab (shared file → tab-type router)", () => {
  afterEach(() => {
    useTabsStore.setState({ tabs: [], layout: null, focusedPaneGroupId: null, activeId: null });
  });

  function openedTab() {
    return useTabsStore.getState().tabs.at(-1);
  }

  it("routes .ipynb to a notebook tab carrying the raw file text", async () => {
    const readText = vi.fn(() => Promise.resolve('{"cells":[]}'));
    await openFileInTab({ filePath: "/ws/run.ipynb", title: "run.ipynb", readText });
    expect(readText).toHaveBeenCalledTimes(1);
    expect(openedTab()).toMatchObject({
      tabType: "notebook",
      kind: "notebook",
      filePath: "/ws/run.ipynb",
      text: '{"cells":[]}',
    });
  });

  it("routes an image to a media tab without reading its bytes as text", async () => {
    const readText = vi.fn(() => Promise.resolve("ignored"));
    await openFileInTab({ filePath: "/ws/logo.png", title: "logo.png", readText });
    expect(readText).not.toHaveBeenCalled();
    expect(openedTab()).toMatchObject({ tabType: "media", filePath: "/ws/logo.png" });
  });

  it("routes a regular file to a text tab with the kind from its extension", async () => {
    const readText = vi.fn(() => Promise.resolve("select 1;"));
    await openFileInTab({ filePath: "/ws/q.sql", title: "q.sql", readText });
    expect(openedTab()).toMatchObject({ tabType: "file", kind: "sql", text: "select 1;" });
  });

  it("applies cursorForText only on the text path (content-search jump)", async () => {
    const readText = vi.fn(() => Promise.resolve("line1\nline2\nline3"));
    await openFileInTab({
      filePath: "/ws/q.sql",
      title: "q.sql",
      readText,
      cursorForText: () => 7,
    });
    expect(openedTab()).toMatchObject({ tabType: "file", cursor: 7 });
  });

  it("invokes onOpened for every routed tab type", async () => {
    const onOpened = vi.fn();
    await openFileInTab({
      filePath: "/ws/a.png",
      title: "a.png",
      readText: () => Promise.resolve(""),
      onOpened,
    });
    await openFileInTab({
      filePath: "/ws/b.ipynb",
      title: "b.ipynb",
      readText: () => Promise.resolve("{}"),
      onOpened,
    });
    await openFileInTab({
      filePath: "/ws/c.sql",
      title: "c.sql",
      readText: () => Promise.resolve("x"),
      onOpened,
    });
    expect(onOpened).toHaveBeenCalledTimes(3);
  });
});
