import { useEffect, useRef } from "react";
import { IconButton } from "@shared/ui/IconButton";
import { Select, type SelectOption } from "@shared/ui";
import type { ChatItem } from "../../types";
import { SHARE_ALL_ROWS_WARNING, SHARE_NO_CONNECTION_HINT } from "../../constants";
import { mountSqlView } from "../../utils";

function ToolCallCard({ tool, summary }: { tool: string; summary: string }) {
  return (
    <div className="mdbc-agent-tool">
      <span className="mdbc-agent-tool-name">▸ {tool}</span>
      {summary ? <span className="mdbc-agent-tool-summary">{summary}</span> : null}
    </div>
  );
}

function SqlBlock({
  sql,
  canShare,
  connectionOptions,
  onInsert,
  onReplace,
  onShareResults,
  onPickConnection,
}: {
  sql: string;
  canShare: boolean;
  connectionOptions: SelectOption[];
  onInsert: (sql: string) => void;
  onReplace: (sql: string) => void;
  onShareResults: (sql: string, allRows: boolean) => void;
  onPickConnection: (connectionId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = mountSqlView(host, sql);
    return () => view.destroy();
  }, [sql]);

  return (
    <div className="mdbc-agent-sql">
      <div className="mdbc-agent-sql-view" ref={hostRef} />
      <div className="mdbc-agent-sql-actions">
        <button type="button" className="mdbc-btn primary" onClick={() => onInsert(sql)}>
          Insert at cursor
        </button>
        <button type="button" className="mdbc-btn" onClick={() => onReplace(sql)}>
          Replace selection
        </button>
        {canShare ? (
          <>
            <button
              type="button"
              className="mdbc-btn mdbc-agent-share-btn"
              onClick={() => onShareResults(sql, false)}
            >
              Run &amp; share 100 rows
            </button>
            <button
              type="button"
              className="mdbc-btn mdbc-agent-share-btn"
              onClick={() => onShareResults(sql, true)}
            >
              Run &amp; share full results
            </button>
          </>
        ) : null}
      </div>
      {canShare ? (
        <div className="mdbc-agent-share-warn">⚠ {SHARE_ALL_ROWS_WARNING}</div>
      ) : (
        <div className="mdbc-agent-share-picker">
          <span className="mdbc-agent-share-hint">⚠ {SHARE_NO_CONNECTION_HINT}</span>
          <Select
            value=""
            options={connectionOptions}
            onChange={onPickConnection}
            placeholder="Choose connection"
          />
        </div>
      )}
    </div>
  );
}

function ResultShareCard({ summary, table }: { summary: string; table: string }) {
  return (
    <details className="mdbc-agent-result">
      <summary className="mdbc-agent-result-summary">{summary}</summary>
      <pre className="mdbc-agent-result-table">{table}</pre>
    </details>
  );
}

function MessageStream({
  items,
  streaming,
  canShare,
  connectionOptions,
  onStop,
  onInsert,
  onReplace,
  onShareResults,
  onPickConnection,
}: {
  items: ChatItem[];
  streaming: boolean;
  canShare: boolean;
  connectionOptions: SelectOption[];
  onStop: () => void;
  onInsert: (sql: string) => void;
  onReplace: (sql: string) => void;
  onShareResults: (sql: string, allRows: boolean) => void;
  onPickConnection: (connectionId: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items.length, streaming]);

  if (items.length === 0 && !streaming) {
    return (
      <div className="mdbc-agent-stream">
        <div className="mdbc-agent-empty">
          <div className="mdbc-agent-empty-title">Ask the agent about your SQL</div>
          <div className="mdbc-agent-empty-text">
            Write, explain, or fix a query. All queries are run locally — we never share your
            credentials.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mdbc-agent-stream">
      {items.map((item) => {
        if (item.kind === "tool") {
          return <ToolCallCard key={item.id} tool={item.tool} summary={item.summary} />;
        }
        if (item.kind === "result") {
          return <ResultShareCard key={item.id} summary={item.summary} table={item.table} />;
        }
        if (item.kind === "sql") {
          return (
            <SqlBlock
              key={item.id}
              sql={item.sql}
              canShare={canShare}
              connectionOptions={connectionOptions}
              onInsert={onInsert}
              onReplace={onReplace}
              onShareResults={onShareResults}
              onPickConnection={onPickConnection}
            />
          );
        }
        return (
          <div key={item.id} className={`mdbc-agent-msg ${item.role}`}>
            {item.text}
          </div>
        );
      })}
      {streaming ? (
        <div className="mdbc-agent-typing">
          <span className="mdbc-agent-dots" aria-label="Agent is working">
            <span />
            <span />
            <span />
          </span>
          <IconButton icon="square" label="Stop" variant="danger" size={13} onClick={onStop} />
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

export { MessageStream };
