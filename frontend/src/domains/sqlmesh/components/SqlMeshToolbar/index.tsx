import { SplitButton } from "@shared/ui";
import type { SplitButtonItem } from "@shared/ui";
import type { SqlMeshToolbarProps } from "./types";

function SqlMeshToolbar({
  isSqlMeshPythonModel,
  smRunningCommand,
  shortcut,
  selector,
  setSelector,
  primaryAction,
  onSelectAction,
  showRendered,
  setShowRendered,
  showLineage,
  setShowLineage,
  isRendering,
  isPreviewing,
  handleSmPlan,
  handleSmRun,
  handleSmTest,
  handleSmRender,
  handleSmLint,
  handleSmAudit,
  handleSmPreview,
}: SqlMeshToolbarProps) {
  const running = !!smRunningCommand;
  // `plan` and `run` are the only commands that accept `--select-model` (same
  // graph syntax as dbt: `+model`, `model+`, wildcards, `tag:`), so they share
  // the editable selector pill. `test`/`render` take different arg shapes (test
  // resolves exact-name test files; render takes a single positional model) and
  // `lint`/`audit` target the active model implicitly, so none carry a pill.
  // The selector + primary action are owned by EditorPane so keyboard shortcuts
  // and toolbar clicks share one source of truth (parity with dbt).

  const planItem: SplitButtonItem = {
    id: "plan",
    label: "Plan",
    title: `sqlmesh plan --select-model ${selector}`,
    scope: selector,
    scopeEditable: true,
    onScopeChange: setSelector,
    shortcut: shortcut("sqlmeshPlan"),
    disabled: running,
    loading: smRunningCommand?.type === "plan",
    onClick: () => handleSmPlan(selector),
  };
  const runItem: SplitButtonItem = {
    id: "run",
    label: "Run",
    title: `sqlmesh run --select-model ${selector}`,
    scope: selector,
    scopeEditable: true,
    onScopeChange: setSelector,
    shortcut: shortcut("sqlmeshRun"),
    disabled: running,
    loading: smRunningCommand?.type === "run",
    onClick: () => handleSmRun(selector),
  };
  const testItem: SplitButtonItem = {
    id: "test",
    label: "Test",
    title: "sqlmesh test",
    shortcut: shortcut("sqlmeshTest"),
    disabled: running,
    loading: smRunningCommand?.type === "test",
    onClick: handleSmTest,
  };
  const renderItem: SplitButtonItem = {
    id: "render",
    label: "Render",
    title: "sqlmesh render",
    shortcut: shortcut("sqlmeshRender"),
    active: showRendered,
    disabled: isRendering,
    loading: smRunningCommand?.type === "render",
    onClick: () => (showRendered ? setShowRendered(false) : handleSmRender()),
  };
  const lintItem: SplitButtonItem = {
    id: "lint",
    label: "Lint",
    title: "sqlmesh lint --model <current model>",
    shortcut: shortcut("sqlmeshLint"),
    disabled: running,
    loading: smRunningCommand?.type === "lint",
    onClick: handleSmLint,
  };
  const auditItem: SplitButtonItem = {
    id: "audit",
    label: "Audit",
    title: "sqlmesh audit --model <current model>",
    shortcut: shortcut("sqlmeshAudit"),
    disabled: running,
    loading: smRunningCommand?.type === "audit",
    onClick: handleSmAudit,
  };
  const lineageItem: SplitButtonItem = {
    id: "lineage",
    label: "Lineage",
    shortcut: shortcut("sqlmeshLineage"),
    active: showLineage,
    onClick: () => setShowLineage((v) => !v),
  };
  const previewItem: SplitButtonItem = {
    id: "preview",
    label: "Preview",
    shortcut: shortcut("sqlmeshPreview"),
    title: isSqlMeshPythonModel
      ? "Preview is unavailable for Python models (no renderable SQL)"
      : "Preview model data (runs rendered SQL with a row limit)",
    disabled: isPreviewing || isSqlMeshPythonModel,
    loading: isPreviewing,
    onClick: handleSmPreview,
  };

  const items = [planItem, runItem, testItem, renderItem, lintItem, auditItem, lineageItem, previewItem];

  return (
    <>
      <div className="mdbc-runbar-sep" />
      <span className="mdbc-dbt-section">
        <img src="/db-logos/sqlmesh.png" alt="sqlmesh" />
        sqlmesh:
      </span>
      <SplitButton
        items={items}
        selectedId={primaryAction ?? "plan"}
        onSelect={onSelectAction}
        data-testid="sqlmesh-splitbutton"
      />
    </>
  );
}

export { SqlMeshToolbar };
