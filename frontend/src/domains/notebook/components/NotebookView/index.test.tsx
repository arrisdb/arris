import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { NotebookView } from "./index";
import { useNotebookStore } from "../../hooks/store";
import type { NotebookCell, NotebookState } from "../../types";

function codeCell(over: Partial<NotebookCell> = {}): NotebookCell {
  return {
    id: "code1",
    cellType: "code",
    source: "print(1)",
    outputs: [],
    executionCount: 3,
    metadata: {},
    rendered: false,
    pendingMsgId: null,
    ...over,
  };
}

function markdownCell(over: Partial<NotebookCell> = {}): NotebookCell {
  return {
    id: "md1",
    cellType: "markdown",
    source: "# Heading",
    outputs: [],
    executionCount: null,
    metadata: {},
    rendered: true,
    pendingMsgId: null,
    ...over,
  };
}

const hookValue = {
  state: {
    status: "idle",
    interpreter: "/usr/bin/python3",
    cells: [markdownCell(), codeCell()],
    metadata: {},
    nbformatMinor: 5,
    execCount: 3,
    dirty: true,
  } as NotebookState,
  interpreters: [{ path: "/usr/bin/python3", version: "3.12.0", source: "path" as const }],
  error: null as string | null,
  onSelectInterpreter: vi.fn(),
  onComplete: vi.fn(),
  runCell: vi.fn(),
  runAll: vi.fn(),
  onInterrupt: vi.fn(),
  onRestart: vi.fn(),
  onCreateVenv: vi.fn().mockResolvedValue(true),
  onBrowseVenvDir: vi.fn(),
  onBrowseInterpreter: vi.fn(),
};

vi.mock("./hooks", () => ({ useNotebook: () => hookValue }));

// Stub the CodeMirror wiring so cells don't mount a real editor in jsdom.
vi.mock("./editor", () => ({
  codeCellExtensions: () => [],
  sqlCellExtensions: () => [],
  markdownCellExtensions: () => [],
  EditorState: { create: () => ({}) },
  EditorView: class {
    destroy() {}
  },
}));

const TAB = { id: "nb1", title: "notebook.ipynb", filePath: "/n.ipynb" } as never;

beforeEach(() => {
  hookValue.runCell = vi.fn();
  hookValue.runAll = vi.fn();
  hookValue.onCreateVenv = vi.fn().mockResolvedValue(true);
});

describe("NotebookView", () => {
  it("renders one block per cell plus add Python/markdown controls", () => {
    render(<NotebookView activeTab={TAB} />);
    expect(screen.getByTestId("notebook")).toBeTruthy();
    expect(screen.getByTestId("notebook-add-code")).toBeTruthy();
    expect(screen.getByTestId("notebook-add-markdown")).toBeTruthy();
  });

  it("renders a markdown cell's HTML when it is in rendered mode", () => {
    render(<NotebookView activeTab={TAB} />);
    const rendered = screen.getByTestId("notebook-markdown-rendered");
    expect(rendered.querySelector("h1")?.textContent).toBe("Heading");
  });

  it("shows the In[n] prompt for code cells", () => {
    render(<NotebookView activeTab={TAB} />);
    expect(screen.getByText("In [3]:")).toBeTruthy();
  });

  it("disables the toolbar's cell actions until a cell is selected", () => {
    const { container } = render(<NotebookView activeTab={TAB} />);
    const runBtn = screen.getByTitle("Run cell") as HTMLButtonElement;
    const deleteBtn = screen.getByTitle("Delete cell") as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
    expect(deleteBtn.disabled).toBe(true);
    fireEvent.mouseDown(container.querySelector('[data-cell-type="code"]') as HTMLElement);
    expect((screen.getByTitle("Run cell") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTitle("Delete cell") as HTMLButtonElement).disabled).toBe(false);
  });

  it("runs the selected cell from the toolbar's Run button", () => {
    const { container } = render(<NotebookView activeTab={TAB} />);
    fireEvent.mouseDown(container.querySelector('[data-cell-type="code"]') as HTMLElement);
    fireEvent.click(screen.getByTitle("Run cell"));
    expect(hookValue.runCell).toHaveBeenCalledWith("code1");
  });

  it("runs all cells from the toolbar", () => {
    render(<NotebookView activeTab={TAB} />);
    fireEvent.click(screen.getByTitle("Run all cells"));
    expect(hookValue.runAll).toHaveBeenCalled();
  });

  it("creates a venv from the toolbar sheet", () => {
    render(<NotebookView activeTab={TAB} />);
    fireEvent.click(screen.getByTestId("notebook-create-venv"));
    fireEvent.click(screen.getByTestId("notebook-venv-create"));
    expect(hookValue.onCreateVenv).toHaveBeenCalledWith(
      "/usr/bin/python3",
      "~/arris-venvs/venv",
    );
  });

  it("disables Interrupt when the kernel is idle", () => {
    render(<NotebookView activeTab={TAB} />);
    expect((screen.getByTitle("Interrupt kernel") as HTMLButtonElement).disabled).toBe(true);
  });

  it("gives every cell-action toolbar button a tooltip (native title)", () => {
    render(<NotebookView activeTab={TAB} />);
    for (const title of [
      "Run cell",
      "Run cell and insert below",
      "Move cell up",
      "Move cell down",
      "Delete cell",
      "Run all cells",
      "Interrupt kernel",
      "Restart kernel",
    ]) {
      expect(screen.getByTitle(title), `missing tooltip: ${title}`).toBeTruthy();
    }
    // The convert button's tooltip flips with the selected cell type.
    expect(
      screen.queryByTitle("Convert to code") || screen.queryByTitle("Convert to markdown"),
    ).toBeTruthy();
  });

  it("shows a running spinner instead of the In[n] prompt while a cell executes", () => {
    hookValue.state = {
      ...hookValue.state,
      cells: [codeCell({ pendingMsgId: "msg-1" })],
    };
    render(<NotebookView activeTab={TAB} />);
    expect(screen.getByTestId("notebook-cell-spinner")).toBeTruthy();
    expect(screen.queryByText("In [3]:")).toBeNull();
    // Restore the shared fixture for later tests.
    hookValue.state = {
      ...hookValue.state,
      cells: [markdownCell(), codeCell()],
    };
  });

  it("run & insert below runs the cell then adds a same-type cell below and selects it", () => {
    // The handler reads + mutates the real notebook store (the hook is mocked),
    // so seed nb1 to match the selected code cell.
    useNotebookStore.setState({
      notebooks: {
        nb1: {
          status: "idle",
          interpreter: "/usr/bin/python3",
          cells: [codeCell({ id: "code1" })],
          metadata: {},
          nbformatMinor: 5,
          execCount: 3,
          dirty: false,
          pending: {},
        },
      },
    });
    const { container } = render(<NotebookView activeTab={TAB} />);
    fireEvent.mouseDown(container.querySelector('[data-cell-type="code"]') as HTMLElement);
    fireEvent.click(screen.getByTestId("notebook-run-insert"));

    expect(hookValue.runCell).toHaveBeenCalledWith("code1");
    const cells = useNotebookStore.getState().notebooks.nb1!.cells;
    expect(cells).toHaveLength(2);
    // New cell sits directly below the run cell and shares its type.
    expect(cells[0].id).toBe("code1");
    expect(cells[1].cellType).toBe("code");
    expect(cells[1].id).not.toBe("code1");
  });
});
