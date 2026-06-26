import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { EditorTab } from "@shell/types";
import type { EditorHandle } from "@domains/editor/utils/ui/setup";
import { SCHEMA_NODE_POINTER_DROP_EVENT } from "@domains/editor/utils/ui/schemaDrag";
import { ConsoleTabView } from "./index";

function tab(overrides?: Partial<EditorTab>): EditorTab {
  return {
    id: "t1",
    title: "Q",
    text: "select * from users",
    kind: "sql",
    cursor: 0,
    connectionId: "c1",
    tabType: "console",
    ...overrides,
  } as EditorTab;
}

function props(overrides?: Partial<Parameters<typeof ConsoleTabView>[0]>): Parameters<typeof ConsoleTabView>[0] {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editorHostRef = createRef<HTMLDivElement>();
  Object.defineProperty(editorHostRef, "current", { value: host });
  const editorHandleRef = createRef<EditorHandle | null>();
  Object.defineProperty(editorHandleRef, "current", {
    value: {
      insertAtCoords: vi.fn(),
      getCursorCoords: vi.fn(),
      insertAtCursor: vi.fn(() => ({ from: 0, to: 1 })),
      highlightRange: vi.fn(),
    },
  });
  return {
    activeTab: tab(),
    groupId: "g1",
    focusGroup: vi.fn(),
    editorHostRef,
    editorHandleRef,
    editorMenu: { state: null, open: vi.fn(), close: vi.fn() },
    editorCtxItems: [],
    onEditorContextMenu: vi.fn(),
    onEditorContextMenuClose: vi.fn(),
    runActiveTab: vi.fn(),
    shortcut: () => undefined,
    tabConnection: { kind: "postgres" },
    tabConnectionId: "c1",
    connections: [{ id: "c1", name: "pg", kind: "postgres" }],
    switchMongoQueryMode: vi.fn(),
    switchEsQueryMode: vi.fn(),
    switchRedisQueryMode: vi.fn(),
    currentDbtNodeName: null,
    currentDbtNodeId: null,
    isDbtModel: false,
    runningCommand: null,
    dbtSelector: "",
    setDbtSelector: vi.fn(),
    dbtPrimaryAction: null,
    setDbtPrimaryAction: vi.fn(),
    showCompiled: false,
    setShowCompiled: vi.fn(),
    setShowLineage: vi.fn(),
    showLineage: false,
    showTransaction: false,
    onToggleTransaction: vi.fn(),
    isCompiling: false,
    handleDbtRun: vi.fn(),
    handleDbtTest: vi.fn(),
    handleDbtBuild: vi.fn(),
    handleDbtCompile: vi.fn(),
    handleDbtPreview: vi.fn(),
    showDiffConfig: false,
    onToggleDiffConfig: vi.fn(),
    onRunDiff: vi.fn(),
    isDiffing: false,
    isPreviewing: false,
    compiledSql: {},
    compiledStale: {},
    compileError: false,
    showDocs: false,
    setShowDocs: vi.fn(),
    isGeneratingDocs: false,
    handleDbtDocs: vi.fn(),
    regenerateDocs: vi.fn(),
    docs: null,
    docsStale: false,
    docsError: false,
    currentSqlMeshModelName: null,
    isSqlMeshModel: false,
    isSqlMeshPythonModel: false,
    isSqlMeshTestFile: false,
    currentSqlMeshTestName: null,
    handleSmTestAtCursor: vi.fn(),
    handleSmTestFile: vi.fn(),
    smRunningCommand: null,
    smSelector: "orders",
    setSmSelector: vi.fn(),
    smPrimaryAction: null,
    setSmPrimaryAction: vi.fn(),
    showRendered: false,
    setShowRendered: vi.fn(),
    isRendering: false,
    renderError: false,
    handleSmRun: vi.fn(),
    handleSmPlan: vi.fn(),
    handleSmTest: vi.fn(),
    handleSmRender: vi.fn(),
    handleSmLint: vi.fn(),
    handleSmAudit: vi.fn(),
    handleSmPreview: vi.fn(),
    renderedSql: {},
    renderedStale: {},
    onSelectConnection: vi.fn(),
    isFederation: false,
    onToggleFederation: vi.fn(),
    onNewTab: vi.fn(),
    isMarkdown: false,
    showRunBar: true,
    markdownView: "raw" as const,
    onSetMarkdownView: vi.fn(),
    markdownSource: "",
    ...overrides,
  };
}

describe("ConsoleTabView", () => {
  it("renders connection selector in runbar", () => {
    const p = props({
      connections: [
        { id: "c1", name: "pg", kind: "postgres" },
        { id: "c2", name: "warehouse", kind: "snowflake" },
      ],
    });
    render(<ConsoleTabView {...p} />);
    const selector = screen.getByTestId("connection-selector");
    expect(selector).toBeTruthy();
    expect(selector.textContent).toContain("pg");
  });

  it("disables the selector and shows an empty-state label when no connections are configured", () => {
    const p = props({ connections: [], tabConnectionId: null });
    render(<ConsoleTabView {...p} />);
    const selector = screen.getByTestId("connection-selector");
    expect((selector as HTMLButtonElement).disabled).toBe(true);
    expect(selector.textContent).toContain("No connections configured");
  });

  it("calls onSelectConnection when picking a connection", () => {
    const p = props({
      connections: [
        { id: "c1", name: "pg", kind: "postgres" },
        { id: "c2", name: "warehouse", kind: "snowflake" },
      ],
    });
    render(<ConsoleTabView {...p} />);
    fireEvent.click(screen.getByTestId("connection-selector"));
    fireEvent.click(screen.getByRole("option", { name: /warehouse/ }));
    expect(p.onSelectConnection).toHaveBeenCalledWith("c2");
  });

  it("renders the federation toggle and info next to the connection selector", () => {
    const p = props({
      connections: [
        { id: "c1", name: "pg", kind: "postgres" },
        { id: "c2", name: "warehouse", kind: "snowflake" },
      ],
    });
    render(<ConsoleTabView {...p} />);
    const toggle = screen.getByTestId("federation-toggle");
    expect(toggle.textContent).toContain("DataFusion");
    expect(toggle.querySelector("input[type='checkbox']")).toBeTruthy();
    expect(screen.getByTestId("federation-info")).toBeTruthy();
    expect(screen.getByTestId("connection-selector")).toBeTruthy();
  });

  it("keeps the connection selector visible but disabled showing All Connections in federation mode", () => {
    const p = props({
      isFederation: true,
      connections: [
        { id: "c1", name: "pg", kind: "postgres" },
        { id: "c2", name: "warehouse", kind: "snowflake" },
      ],
    });
    render(<ConsoleTabView {...p} />);
    const selector = screen.getByTestId("connection-selector") as HTMLButtonElement;
    expect(selector).toBeTruthy();
    expect(selector.disabled).toBe(true);
    expect(selector.textContent).toContain("All Connections");
    const checkbox = screen
      .getByTestId("federation-toggle")
      .querySelector("input[type='checkbox']") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("disables the federation toggle when fewer than two connections exist", () => {
    const p = props({ connections: [{ id: "c1", name: "pg", kind: "postgres" }] });
    render(<ConsoleTabView {...p} />);
    const toggle = screen.getByTestId("federation-toggle");
    expect(toggle.className).toContain("disabled");
    const checkbox = toggle.querySelector("input[type='checkbox']") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it("enables the federation toggle when two or more connections exist", () => {
    const p = props({
      connections: [
        { id: "c1", name: "pg", kind: "postgres" },
        { id: "c2", name: "warehouse", kind: "snowflake" },
      ],
    });
    render(<ConsoleTabView {...p} />);
    const toggle = screen.getByTestId("federation-toggle");
    expect(toggle.className).not.toContain("disabled");
    const checkbox = toggle.querySelector("input[type='checkbox']") as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
  });

  it("calls onToggleFederation when the toggle is flipped", () => {
    const p = props({
      connections: [
        { id: "c1", name: "pg", kind: "postgres" },
        { id: "c2", name: "warehouse", kind: "snowflake" },
      ],
    });
    render(<ConsoleTabView {...p} />);
    const checkbox = screen
      .getByTestId("federation-toggle")
      .querySelector("input[type='checkbox']") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(p.onToggleFederation).toHaveBeenCalledTimes(1);
  });

  it("renders console-specific run controls and editor host", () => {
    const p = props();
    render(<ConsoleTabView {...p} />);

    fireEvent.click(screen.getByTestId("run-button"));

    expect(p.runActiveTab).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("stop-button")).toBeTruthy();
    expect(document.querySelector(".mdbc-editor-host")).toBeTruthy();
  });

  it("hides the entire run bar for non-runnable file kinds", () => {
    const p = props({ showRunBar: false, activeTab: tab({ kind: "json" }) });
    render(<ConsoleTabView {...p} />);
    expect(document.querySelector(".mdbc-runbar")).toBeNull();
    expect(screen.queryByTestId("run-button")).toBeNull();
    expect(screen.queryByTestId("federation-bar")).toBeNull();
  });

  it("renders the run bar for runnable sql tabs", () => {
    const p = props({ showRunBar: true });
    render(<ConsoleTabView {...p} />);
    expect(document.querySelector(".mdbc-runbar")).toBeTruthy();
    expect(screen.getByTestId("run-button")).toBeTruthy();
  });

  it("offers Preview in the dbt split-button menu and runs it on click", () => {
    const p = props({ isDbtModel: true, currentDbtNodeName: "stg_orders" });
    render(<ConsoleTabView {...p} />);
    fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle"));
    fireEvent.click(screen.getByTestId("dbt-splitbutton-item-preview"));
    expect(p.handleDbtPreview).toHaveBeenCalledTimes(1);
  });

  it("hides the dbt split button when the file is not a dbt model", () => {
    const p = props({ isDbtModel: false });
    render(<ConsoleTabView {...p} />);
    expect(screen.queryByTestId("dbt-splitbutton-toggle")).toBeNull();
  });

  it("disables the Preview menu item while a preview is in flight", () => {
    const p = props({ isDbtModel: true, currentDbtNodeName: "stg_orders", isPreviewing: true });
    render(<ConsoleTabView {...p} />);
    fireEvent.click(screen.getByTestId("dbt-splitbutton-toggle"));
    expect(screen.getByTestId("dbt-splitbutton-item-preview").className).toContain("disabled");
  });

  it("offers Preview in the sqlmesh split-button menu and runs it on click", () => {
    const p = props({ isSqlMeshModel: true, currentSqlMeshModelName: "orders" });
    render(<ConsoleTabView {...p} />);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-item-preview"));
    expect(p.handleSmPreview).toHaveBeenCalledTimes(1);
  });

  it("hides the sqlmesh split button when the file is not a sqlmesh model", () => {
    const p = props({ isSqlMeshModel: false });
    render(<ConsoleTabView {...p} />);
    expect(screen.queryByTestId("sqlmesh-splitbutton-toggle")).toBeNull();
  });

  it("disables the sqlmesh Preview menu item while a preview is in flight", () => {
    const p = props({ isSqlMeshModel: true, currentSqlMeshModelName: "orders", isPreviewing: true });
    render(<ConsoleTabView {...p} />);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    expect(screen.getByTestId("sqlmesh-splitbutton-item-preview").className).toContain("disabled");
  });

  it("disables the sqlmesh Preview menu item for Python models", () => {
    const p = props({ isSqlMeshModel: true, currentSqlMeshModelName: "customer_segments", isSqlMeshPythonModel: true });
    render(<ConsoleTabView {...p} />);
    fireEvent.click(screen.getByTestId("sqlmesh-splitbutton-toggle"));
    const item = screen.getByTestId("sqlmesh-splitbutton-item-preview");
    expect(item.className).toContain("disabled");
    fireEvent.click(item);
    expect(p.handleSmPreview).not.toHaveBeenCalled();
  });

  it("shows the sqlmesh test toolbar and runs the test at the cursor", () => {
    const p = props({ isSqlMeshTestFile: true, currentSqlMeshTestName: "test_dim_customers_rollup" });
    render(<ConsoleTabView {...p} />);
    fireEvent.click(screen.getByTestId("sqlmesh-test-splitbutton-primary"));
    expect(p.handleSmTestAtCursor).toHaveBeenCalledTimes(1);
  });

  it("runs all tests in the file from the sqlmesh test menu", () => {
    const p = props({ isSqlMeshTestFile: true, currentSqlMeshTestName: "test_a" });
    render(<ConsoleTabView {...p} />);
    fireEvent.click(screen.getByTestId("sqlmesh-test-splitbutton-toggle"));
    fireEvent.click(screen.getByTestId("sqlmesh-test-splitbutton-item-test-file"));
    expect(p.handleSmTestFile).toHaveBeenCalledTimes(1);
  });

  it("disables test-at-cursor when the cursor is not inside a test", () => {
    const p = props({ isSqlMeshTestFile: true, currentSqlMeshTestName: null });
    render(<ConsoleTabView {...p} />);
    fireEvent.click(screen.getByTestId("sqlmesh-test-splitbutton-primary"));
    expect(p.handleSmTestAtCursor).not.toHaveBeenCalled();
  });

  it("hides the sqlmesh test toolbar when the file is not a test file", () => {
    const p = props({ isSqlMeshTestFile: false });
    render(<ConsoleTabView {...p} />);
    expect(screen.queryByTestId("sqlmesh-test-splitbutton-toggle")).toBeNull();
  });

  it("shows the Redis SQL/CLI mode toggle for a redis connection and switches to CLI", () => {
    const p = props({
      tabConnection: { kind: "redis" },
      activeTab: tab({ kind: "redis" }),
      connections: [{ id: "c1", name: "cache", kind: "redis" }],
    });
    render(<ConsoleTabView {...p} />);

    // SQL is active, CLI is the alternate.
    const sqlBtn = screen.getByTestId("redis-sql-mode-button");
    const cliBtn = screen.getByTestId("redis-cli-mode-button");
    expect(sqlBtn.className).toContain("active");
    expect(cliBtn.className).not.toContain("active");

    fireEvent.click(cliBtn);
    expect(p.switchRedisQueryMode).toHaveBeenCalledWith("rediscli");
  });

  it("does not render the Redis mode toggle for a non-redis connection", () => {
    const p = props({ tabConnection: { kind: "postgres" } });
    render(<ConsoleTabView {...p} />);
    expect(screen.queryByTestId("redis-sql-mode-button")).toBeNull();
    expect(screen.queryByTestId("redis-cli-mode-button")).toBeNull();
  });

  it("inserts schema pointer drops into the console editor", () => {
    const p = props();
    render(<ConsoleTabView {...p} />);

    window.dispatchEvent(new CustomEvent(SCHEMA_NODE_POINTER_DROP_EVENT, {
      detail: {
        insertText: "orders",
        clientX: Number.NaN,
        clientY: Number.NaN,
      },
    }));

    expect(p.focusGroup).toHaveBeenCalledWith("g1");
    expect(p.editorHandleRef.current?.insertAtCoords).toHaveBeenCalledWith(
      Number.NaN,
      Number.NaN,
      "orders",
    );
  });
});
