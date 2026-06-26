import { Icon } from "@shared/ui/Icon";
import { SplitButton } from "@shared/ui";
import type { SplitButtonItem } from "@shared/ui";
import type { DbtToolbarProps } from "./types";

function DbtToolbar({
  isDbtModel,
  runningCommand,
  shortcut,
  selector,
  setSelector,
  primaryAction,
  onSelectAction,
  showCompiled,
  setShowCompiled,
  showLineage,
  setShowLineage,
  showDocs,
  isCompiling,
  isGeneratingDocs,
  isPreviewing,
  handleDbtRun,
  handleDbtTest,
  handleDbtBuild,
  handleDbtCompile,
  handleDbtDocs,
  handleDbtPreview,
  showDiffConfig,
  onToggleDiffConfig,
}: DbtToolbarProps) {
  const running = !!runningCommand;
  const playIcon = <Icon name="play" size={12} />;

  const runItem: SplitButtonItem = {
    id: "run",
    label: "Run",
    icon: playIcon,
    title: `dbt run --select ${selector}`,
    scope: selector,
    scopeEditable: true,
    onScopeChange: setSelector,
    shortcut: shortcut("dbtRun"),
    disabled: running,
    loading: runningCommand?.type === "run",
    onClick: () => handleDbtRun(selector),
  };
  const testItem: SplitButtonItem = {
    id: "test",
    label: "Test",
    icon: playIcon,
    title: `dbt test --select ${selector}`,
    scope: selector,
    scopeEditable: true,
    onScopeChange: setSelector,
    shortcut: shortcut("dbtTest"),
    disabled: running,
    loading: runningCommand?.type === "test",
    onClick: () => handleDbtTest(selector),
  };
  const buildItem: SplitButtonItem = {
    id: "build",
    label: "Build",
    icon: playIcon,
    title: `dbt build --select ${selector}`,
    scope: selector,
    scopeEditable: true,
    onScopeChange: setSelector,
    shortcut: shortcut("dbtBuild"),
    disabled: running,
    loading: runningCommand?.type === "build",
    onClick: () => handleDbtBuild(selector),
  };
  const compileItem: SplitButtonItem = {
    id: "compile",
    label: "Compile",
    shortcut: shortcut("dbtCompile"),
    active: showCompiled,
    disabled: isCompiling,
    loading: runningCommand?.type === "compile",
    onClick: () => (showCompiled ? setShowCompiled(false) : handleDbtCompile()),
  };
  const docsItem: SplitButtonItem = {
    id: "docs",
    label: "Docs",
    shortcut: shortcut("dbtDocs"),
    active: showDocs,
    disabled: isGeneratingDocs,
    loading: isGeneratingDocs,
    onClick: handleDbtDocs,
  };
  const lineageItem: SplitButtonItem = {
    id: "lineage",
    label: "Lineage",
    shortcut: shortcut("dbtLineage"),
    active: showLineage,
    onClick: () => setShowLineage((v) => !v),
  };
  const previewItem: SplitButtonItem = {
    id: "preview",
    label: "Preview",
    shortcut: shortcut("dbtPreview"),
    disabled: isPreviewing,
    loading: isPreviewing,
    onClick: handleDbtPreview,
  };
  const diffItem: SplitButtonItem = {
    id: "diff",
    label: "Diff",
    title: "Diff this model's new output against its prod table",
    shortcut: shortcut("dbtDiff"),
    active: showDiffConfig,
    onClick: onToggleDiffConfig,
  };

  // Models expose the full command set; test files (and other non-model nodes)
  // get the subset that applies to them, with Test as the primary action.
  const modelItems = [runItem, testItem, buildItem, compileItem, docsItem, lineageItem, previewItem, diffItem];
  const testItems = [testItem, buildItem, compileItem, lineageItem];

  // The selected action is owned by EditorPane so keyboard shortcuts and clicks
  // both move the primary button. Fall back to the first item per node kind.
  const selectedActionId = primaryAction ?? (isDbtModel ? "run" : "test");

  return (
    <>
      <div className="mdbc-runbar-sep" />
      <span className="mdbc-dbt-section">
        <img src="/db-logos/dbt.png" alt="dbt" />
        dbt:
      </span>
      {isDbtModel ? (
        <SplitButton
          items={modelItems}
          selectedId={selectedActionId}
          onSelect={onSelectAction}
          data-testid="dbt-splitbutton"
        />
      ) : (
        <SplitButton
          items={testItems}
          selectedId={selectedActionId}
          onSelect={onSelectAction}
          data-testid="dbt-splitbutton"
        />
      )}
    </>
  );
}

export { DbtToolbar };
