import { useState } from "react";
import { Icon } from "@shared/ui/Icon";
import type { IconName } from "@shared/ui/Icon";
import { MAX_RAW_QUERY_LINES } from "../../constants";
import { formatDuration, renderAnsiText } from "../../utils";
import type { CommandLogEntryProps } from "../../types";
import type { CommandLogStatus } from "../../../../types";

function statusIconName(status: CommandLogStatus): IconName {
  if (status === "success") return "check";
  if (status === "error") return "x";
  return "loader";
}

function CommandLogEntry({
  command,
  status,
  durationLabel,
  timestampLabel,
  nodes,
  rawOutput,
  rawQuery,
  tabTitle,
  defaultExpanded = false,
  children,
}: CommandLogEntryProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [queryExpanded, setQueryExpanded] = useState(false);
  const queryIsLong =
    rawQuery != null && rawQuery.split("\n").length > MAX_RAW_QUERY_LINES;
  return (
    <div className={`mdbc-cmdlog-entry ${status}`} data-testid="command-log-entry">
      <button
        type="button"
        className="mdbc-cmdlog-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="mdbc-cmdlog-chevron">{expanded ? "▾" : "▸"}</span>
        <span className={`mdbc-cmdlog-status ${status}`}>
          <Icon name={statusIconName(status)} size={14} />
        </span>
        <code className="mdbc-cmdlog-command">{command}</code>
        {tabTitle && <span className="mdbc-cmdlog-tab">[{tabTitle}]</span>}
        <span className="mdbc-cmdlog-meta">
          {durationLabel !== "" && (
            <span className="mdbc-cmdlog-duration">{durationLabel}</span>
          )}
          <span className="mdbc-cmdlog-timestamp">{timestampLabel}</span>
        </span>
      </button>

      {expanded && (
        <div className="mdbc-cmdlog-body">
          {children ?? (
            <>
              {nodes.length > 0 && (
                <div className="mdbc-cmdlog-nodes">
                  {nodes.map((node, index) => (
                    <div key={index} className={`mdbc-cmdlog-node ${node.status}`}>
                      <span className="mdbc-cmdlog-node-status">
                        {node.status === "success" ? "OK" : "ERROR"}
                      </span>
                      <span className="mdbc-cmdlog-node-name">{node.name}</span>
                      <span className="mdbc-cmdlog-node-type">[{node.type}]</span>
                      <span className="mdbc-cmdlog-node-duration">
                        {formatDuration(node.durationMs)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {rawOutput !== "" && (
                <div className="mdbc-cmdlog-raw">
                  <div className="mdbc-cmdlog-raw-label">
                    <span className="mdbc-cmdlog-raw-label-text">
                      <Icon name="terminal" size={12} /> Raw output
                    </span>
                  </div>
                  <pre className={`mdbc-cmdlog-pre${status === "error" ? " error" : ""}`}>
                    {renderAnsiText(rawOutput) ?? rawOutput}
                  </pre>
                </div>
              )}
              {rawQuery != null && rawQuery !== "" && (
                <div className="mdbc-cmdlog-raw">
                  <div className="mdbc-cmdlog-raw-label">
                    <span className="mdbc-cmdlog-raw-label-text">
                      <Icon name="terminal" size={12} /> Raw query
                    </span>
                    {queryIsLong && (
                      <button
                        type="button"
                        className="mdbc-btn"
                        onClick={() => setQueryExpanded((prev) => !prev)}
                      >
                        {queryExpanded ? "Show less" : "Show full query"}
                      </button>
                    )}
                  </div>
                  <pre
                    className={`mdbc-cmdlog-pre${queryIsLong && !queryExpanded ? " capped" : ""}`}
                  >
                    {rawQuery}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export {
  CommandLogEntry,
};
