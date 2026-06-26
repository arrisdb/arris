import { useMemo } from "react";
import { IconButton, SectionedSelect, Select, Tooltip } from "@shared/ui";
import { ContextMenu } from "@shared/ui/ContextMenu";
import { DatabaseKindIcon } from "@domains/connection";
import { Icon } from "@shared/ui/Icon";
import { stopActiveQuery } from "../../utils";
import { TransactionPane } from "../TransactionPane";
import { useTransactionStore } from "../../../../hooks/transactionStore";
import type { IsolationLevel, TransactionMode } from "../../../../types";
import { TRANSACTIONAL_KINDS, TX_ISOLATION_OPTIONS, TX_MODE_OPTIONS } from "./constants";
import { CompiledPreview } from "../../../CompiledPreview";
import { DbtToolbar, DbtDocsPreview } from "@domains/dbt";
import { LineageContainer } from "@domains/lineage";
import { useSchemaPointerDrop } from "./hooks";
import { DbtDiffBar } from "../SlimDiff";
import { SUPPORTED_KINDS } from "../SlimDiff/constants";
import { SqlMeshToolbar, SqlMeshTestToolbar } from "@domains/sqlmesh";
import { MarkdownPreview } from "../../../MarkdownPreview";
import type { ConsoleTabViewProps } from "./types";

function ConsoleTabView({
  activeTab,
  groupId,
  focusGroup,
  editorHostRef,
  editorHandleRef,
  editorMenu,
  editorCtxItems,
  onEditorContextMenu,
  onEditorContextMenuClose,
  runActiveTab,
  shortcut,
  tabConnection,
  tabConnectionId,
  connections,
  switchMongoQueryMode,
  switchEsQueryMode,
  switchRedisQueryMode,
  currentDbtNodeName,
  currentDbtNodeId,
  isDbtModel,
  runningCommand,
  dbtSelector,
  setDbtSelector,
  dbtPrimaryAction,
  setDbtPrimaryAction,
  showCompiled,
  setShowCompiled,
  setShowLineage,
  showLineage,
  showTransaction,
  onToggleTransaction,
  isCompiling,
  handleDbtRun,
  handleDbtTest,
  handleDbtBuild,
  handleDbtCompile,
  handleDbtPreview,
  showDiffConfig,
  onToggleDiffConfig,
  onRunDiff,
  isDiffing,
  isPreviewing,
  compiledSql,
  compiledStale,
  compileError,
  showDocs,
  setShowDocs,
  isGeneratingDocs,
  handleDbtDocs,
  regenerateDocs,
  docs,
  docsStale,
  docsError,
  currentSqlMeshModelName,
  isSqlMeshModel,
  isSqlMeshPythonModel,
  isSqlMeshTestFile,
  currentSqlMeshTestName,
  handleSmTestAtCursor,
  handleSmTestFile,
  smRunningCommand,
  smSelector,
  setSmSelector,
  smPrimaryAction,
  setSmPrimaryAction,
  showRendered,
  setShowRendered,
  isRendering,
  renderError,
  handleSmPlan,
  handleSmRun,
  handleSmTest,
  handleSmRender,
  handleSmLint,
  handleSmAudit,
  handleSmPreview,
  renderedSql,
  renderedStale,
  onSelectConnection,
  isFederation,
  onToggleFederation,
  onNewTab,
  isMarkdown,
  showRunBar,
  markdownView,
  onSetMarkdownView,
  markdownSource,
}: ConsoleTabViewProps) {
  useSchemaPointerDrop({
    activeTab,
    editorHandleRef,
    editorHostRef,
    focusGroup,
    groupId,
  });

  const connectionOptions = useMemo(
    () => connections.map((c) => ({
      value: c.id,
      label: c.name,
      icon: <DatabaseKindIcon kind={c.kind} size={14} />,
    })),
    [connections],
  );

  const txState = useTransactionStore((s) =>
    tabConnectionId ? s.byConnection[tabConnectionId] : undefined,
  );
  const setTxMode = useTransactionStore((s) => s.setMode);
  const setTxIsolation = useTransactionStore((s) => s.setIsolation);
  const commitTx = useTransactionStore((s) => s.commit);
  const rollbackTx = useTransactionStore((s) => s.rollback);
  const txMode: TransactionMode = txState?.mode ?? "auto";
  const txIsolation: IsolationLevel = txState?.isolation ?? "default";
  const txDirty = txState?.dirty ?? false;
  const txSupported =
    !!tabConnectionId &&
    !isFederation &&
    !isMarkdown &&
    activeTab?.tabType !== "table" &&
    !!tabConnection?.kind &&
    TRANSACTIONAL_KINDS.has(tabConnection.kind);

  return (
    <>
      {showRunBar && (
      <div className="mdbc-runbar">
        {!isMarkdown && (
          <div className="mdbc-btn-group plain" data-testid="runbar-actions">
            <Tooltip label="Run Query" shortcut={shortcut("runQuery")}>
              <IconButton
                icon="play"
                label="Run Query"
                variant="primary"
                size={13}
                loading={!!activeTab?.isRunning}
                onClick={runActiveTab}
                disabled={!activeTab || activeTab.isRunning}
                data-testid="run-button"
              />
            </Tooltip>
            <Tooltip label="Stop Query" shortcut={shortcut("stopQuery")}>
              <IconButton
                icon="square"
                label="Stop Query"
                variant="ghost"
                size={12}
                onClick={stopActiveQuery}
                disabled={!activeTab?.isRunning}
                data-testid="stop-button"
              />
            </Tooltip>
          </div>
        )}
        {txSupported && (
          <>
            <div className="mdbc-runbar-sep" />
            <div className="mdbc-btn-group plain" data-testid="tx-bar">
              <SectionedSelect
                triggerLabel={`Tx: ${txMode === "manual" ? "Manual" : "Auto"}`}
                title="Transaction mode & isolation"
                data-testid="tx-config-select"
                sections={[
                  {
                    title: "Transaction Mode",
                    value: txMode,
                    // Block leaving manual mode while a transaction is open: the
                    // user must Commit or Roll back first (buttons below).
                    options: TX_MODE_OPTIONS.map((o) =>
                      o.value === "auto" && txMode === "manual" && txDirty
                        ? {
                            ...o,
                            disabled: true,
                            hint: "Commit or roll back the open transaction first",
                          }
                        : o,
                    ),
                    onChange: (v) => {
                      if (tabConnectionId) void setTxMode(tabConnectionId, v as TransactionMode);
                    },
                  },
                  {
                    title: "Transaction Isolation",
                    value: txIsolation,
                    options: TX_ISOLATION_OPTIONS,
                    onChange: (v) => {
                      if (tabConnectionId) void setTxIsolation(tabConnectionId, v as IsolationLevel);
                    },
                  },
                ]}
              />
              {txMode === "manual" && (
                <>
                  <Tooltip label="Commit transaction">
                    <IconButton
                      icon="check"
                      label="Commit transaction"
                      variant="ghost"
                      size={13}
                      onClick={() => {
                        if (tabConnectionId) void commitTx(tabConnectionId);
                      }}
                      disabled={!txDirty}
                      data-testid="tx-commit-button"
                    />
                  </Tooltip>
                  <Tooltip label="Roll back transaction">
                    <IconButton
                      icon="rotateCcw"
                      label="Roll back transaction"
                      variant="ghost"
                      size={13}
                      onClick={() => {
                        if (tabConnectionId) void rollbackTx(tabConnectionId);
                      }}
                      disabled={!txDirty}
                      data-testid="tx-rollback-button"
                    />
                  </Tooltip>
                  <Tooltip label="Transaction statements">
                    <IconButton
                      icon="list"
                      label="Transaction statements"
                      variant="ghost"
                      size={13}
                      active={showTransaction}
                      onClick={onToggleTransaction}
                      data-testid="tx-statements-button"
                    />
                  </Tooltip>
                </>
              )}
            </div>
          </>
        )}
        {tabConnection?.kind === "mongodb" && activeTab?.tabType !== "table" && !activeTab?.isFederation && (
          <>
            <div className="mdbc-runbar-sep" />
            <button
              className={`mdbc-btn ghost${activeTab?.kind === "mongodb" ? " active" : ""}`}
              onClick={() => switchMongoQueryMode("mongodb")}
              disabled={!activeTab}
              data-testid="mongo-sql-mode-button"
            >
              SQL
            </button>
            <button
              className={`mdbc-btn ghost${activeTab?.kind === "mongoshell" ? " active" : ""}`}
              onClick={() => switchMongoQueryMode("mongoshell")}
              disabled={!activeTab}
              data-testid="mongo-shell-mode-button"
            >
              mongosh
            </button>
          </>
        )}
        {tabConnection?.kind === "elasticsearch" && activeTab?.tabType !== "table" && !activeTab?.isFederation && (
          <>
            <div className="mdbc-runbar-sep" />
            <button
              className={`mdbc-btn ghost${activeTab?.kind === "elasticsearch" ? " active" : ""}`}
              onClick={() => switchEsQueryMode("elasticsearch")}
              disabled={!activeTab}
              data-testid="es-sql-mode-button"
            >
              SQL
            </button>
            <button
              className={`mdbc-btn ghost${activeTab?.kind === "esrest" ? " active" : ""}`}
              onClick={() => switchEsQueryMode("esrest")}
              disabled={!activeTab}
              data-testid="es-rest-mode-button"
            >
              REST
            </button>
          </>
        )}
        {tabConnection?.kind === "redis" && activeTab?.tabType !== "table" && !activeTab?.isFederation && (
          <>
            <div className="mdbc-runbar-sep" />
            <button
              className={`mdbc-btn ghost${activeTab?.kind === "redis" ? " active" : ""}`}
              onClick={() => switchRedisQueryMode("redis")}
              disabled={!activeTab}
              data-testid="redis-sql-mode-button"
            >
              SQL
            </button>
            <button
              className={`mdbc-btn ghost${activeTab?.kind === "rediscli" ? " active" : ""}`}
              onClick={() => switchRedisQueryMode("rediscli")}
              disabled={!activeTab}
              data-testid="redis-cli-mode-button"
            >
              redis-cli
            </button>
          </>
        )}
        {isMarkdown && (
          <>
            <button
              className={`mdbc-btn ghost${markdownView === "raw" ? " active" : ""}`}
              onClick={() => onSetMarkdownView("raw")}
              data-testid="md-raw-button"
            >
              Raw
            </button>
            <button
              className={`mdbc-btn ghost${markdownView === "rendered" ? " active" : ""}`}
              onClick={() => onSetMarkdownView("rendered")}
              data-testid="md-rendered-button"
            >
              Preview
            </button>
            <button
              className={`mdbc-btn ghost${markdownView === "split" ? " active" : ""}`}
              onClick={() => onSetMarkdownView("split")}
              data-testid="md-split-button"
            >
              Split
            </button>
          </>
        )}
        {!!currentDbtNodeName && (
          <DbtToolbar
            key={currentDbtNodeName}
            isDbtModel={isDbtModel}
            runningCommand={runningCommand}
            shortcut={shortcut}
            selector={dbtSelector}
            setSelector={setDbtSelector}
            primaryAction={dbtPrimaryAction}
            onSelectAction={setDbtPrimaryAction}
            showCompiled={showCompiled}
            setShowCompiled={setShowCompiled}
            showLineage={showLineage}
            setShowLineage={setShowLineage}
            showDocs={showDocs}
            isCompiling={isCompiling}
            isGeneratingDocs={isGeneratingDocs}
            isPreviewing={isPreviewing}
            handleDbtRun={handleDbtRun}
            handleDbtTest={handleDbtTest}
            handleDbtBuild={handleDbtBuild}
            handleDbtCompile={handleDbtCompile}
            handleDbtDocs={handleDbtDocs}
            handleDbtPreview={handleDbtPreview}
            showDiffConfig={showDiffConfig}
            onToggleDiffConfig={onToggleDiffConfig}
          />
        )}
        {isSqlMeshModel && currentSqlMeshModelName && (
          <SqlMeshToolbar
            key={currentSqlMeshModelName}
            isSqlMeshPythonModel={isSqlMeshPythonModel}
            smRunningCommand={smRunningCommand}
            shortcut={shortcut}
            selector={smSelector}
            setSelector={setSmSelector}
            primaryAction={smPrimaryAction}
            onSelectAction={setSmPrimaryAction}
            showRendered={showRendered}
            setShowRendered={setShowRendered}
            showLineage={showLineage}
            setShowLineage={setShowLineage}
            isRendering={isRendering}
            isPreviewing={isPreviewing}
            handleSmPlan={handleSmPlan}
            handleSmRun={handleSmRun}
            handleSmTest={handleSmTest}
            handleSmRender={handleSmRender}
            handleSmLint={handleSmLint}
            handleSmAudit={handleSmAudit}
            handleSmPreview={handleSmPreview}
          />
        )}
        {isSqlMeshTestFile && (
          <SqlMeshTestToolbar
            currentSqlMeshTestName={currentSqlMeshTestName}
            smRunningCommand={smRunningCommand}
            handleSmTestAtCursor={handleSmTestAtCursor}
            handleSmTestFile={handleSmTestFile}
          />
        )}
        <div className="mdbc-flex-spacer" />
        {!isMarkdown && (
          <div className="mdbc-fed-bar" data-testid="federation-bar">
            <label
              className={`mdbc-fed-toggle${connections.length < 2 ? " disabled" : ""}`}
              data-testid="federation-toggle"
            >
              <span className="mdbc-fed-toggle-label">DataFusion</span>
              <span className="mdbc-settings-toggle">
                <input
                  type="checkbox"
                  checked={isFederation}
                  disabled={connections.length < 2}
                  onChange={onToggleFederation}
                />
                <span className="mdbc-settings-toggle-track">
                  <span className="mdbc-settings-toggle-thumb" />
                </span>
              </span>
            </label>
            <Tooltip label="Query across all connections at once. Needs 2+ connections.">
              <span className="mdbc-fed-info" data-testid="federation-info">
                <Icon name="info" size={13} />
              </span>
            </Tooltip>
            <Select
              value={isFederation ? "__all__" : (tabConnectionId ?? "")}
              options={
                isFederation
                  ? [{ value: "__all__", label: "All Connections", icon: <Icon name="layers" size={14} /> }]
                  : connectionOptions
              }
              onChange={onSelectConnection}
              disabled={isFederation || connections.length === 0}
              placeholder={connections.length === 0 ? "No connections configured" : "Select connection…"}
              maxWidth={connections.length === 0 ? undefined : 200}
              data-testid="connection-selector"
            />
          </div>
        )}
      </div>
      )}
      {showDiffConfig && isDbtModel && !!currentDbtNodeName && (() => {
        const diffConn = connections.find((c) => c.id === tabConnectionId);
        return (
          <DbtDiffBar
            key={currentDbtNodeName}
            model={currentDbtNodeName}
            hasConnection={!!diffConn}
            supported={!!diffConn && SUPPORTED_KINDS.has(diffConn.kind)}
            running={isDiffing}
            onRun={onRunDiff}
            onClose={onToggleDiffConfig}
          />
        );
      })()}
      {activeTab ? (
        <div className="mdbc-editor-layout">
          <div
            ref={editorHostRef}
            className={`mdbc-editor-host${isMarkdown && markdownView === "rendered" ? " hidden" : ""}`}
            onContextMenu={onEditorContextMenu}
          />
          {editorMenu.state && (
            <ContextMenu
              x={editorMenu.state.x}
              y={editorMenu.state.y}
              items={editorCtxItems}
              onClose={onEditorContextMenuClose}
              data-testid="editor-ctx-menu"
            />
          )}
          {isMarkdown && markdownView !== "raw" && (
            <>
              {markdownView === "split" && <div className="mdbc-pane-sep" />}
              <div className="mdbc-tab-content">
                <MarkdownPreview source={markdownSource} />
              </div>
            </>
          )}
          {showCompiled && currentDbtNodeName && (
            <>
              <div className="mdbc-pane-sep" />
              <div className="mdbc-tab-content">
                <CompiledPreview
                  compiledSql={compiledSql[currentDbtNodeName] ?? ""}
                  isStale={compiledStale[currentDbtNodeName] ?? false}
                  isLoading={isCompiling}
                  hasError={compileError}
                  onRefresh={handleDbtCompile}
                  onCollapse={() => setShowCompiled(false)}
                />
              </div>
            </>
          )}
          {showDocs && isDbtModel && currentDbtNodeName && (
            <>
              <div className="mdbc-pane-sep" />
              <div className="mdbc-tab-content">
                <DbtDocsPreview
                  docs={docs}
                  modelId={currentDbtNodeId}
                  isLoading={isGeneratingDocs}
                  isStale={docsStale}
                  hasError={docsError}
                  onRefresh={regenerateDocs}
                  onCollapse={() => setShowDocs(false)}
                />
              </div>
            </>
          )}
          {showRendered && isSqlMeshModel && currentSqlMeshModelName && (
            <>
              <div className="mdbc-pane-sep" />
              <div className="mdbc-tab-content">
                <CompiledPreview
                  compiledSql={renderedSql[currentSqlMeshModelName] ?? ""}
                  isStale={renderedStale[currentSqlMeshModelName] ?? false}
                  isLoading={isRendering}
                  hasError={renderError}
                  onRefresh={handleSmRender}
                  onCollapse={() => setShowRendered(false)}
                />
              </div>
            </>
          )}
          {showLineage && (currentDbtNodeName || currentSqlMeshModelName) && (
            <>
              <div className="mdbc-pane-sep" />
              <div className="mdbc-tab-content">
                <LineageContainer onClose={() => setShowLineage(() => false)} />
              </div>
            </>
          )}
          {showTransaction && tabConnectionId && (
            <>
              <div className="mdbc-pane-sep" />
              <div className="mdbc-tab-content">
                <TransactionPane connectionId={tabConnectionId} onCollapse={onToggleTransaction} />
              </div>
            </>
          )}
        </div>
      ) : (
        <div
          className="mdbc-centered-hint large"
        >
          <span>No tab in this pane.</span>
          <button className="mdbc-btn primary" onClick={onNewTab}>
            New query
          </button>
        </div>
      )}
    </>
  );
}

export { ConsoleTabView };
