import { Icon } from "@shared/ui/Icon";
import { IconButton, Tooltip } from "@shared/ui";
import { highlightSql } from "@shared/ui/utils/highlightSql";
import type {
  PinnedQueriesPaneViewModel,
  PinnedQueryButtonEvent,
  PinnedQueryRenameInputProps,
  PinnedQueryRenameKeyEvent,
  PinnedQueryRowProps,
} from "../../types";
import { queryPreview } from "../../utils";

function PinnedQueriesContent({ pane }: { pane: PinnedQueriesPaneViewModel }) {
  if (pane.queries.length === 0) {
    return (
      <div className="mdbc-pinned-queries-empty">
        No pinned queries yet. Right-click in the query editor or use the{" "}
        <Icon name="pin" size={11} /> button in the results toolbar to pin a query.
      </div>
    );
  }

  return (
    <div className="mdbc-pinned-queries-list">
      {pane.queries.map((query) => (
        <PinnedQueryRow
          key={query.id}
          query={query}
          copied={pane.copiedId === query.id}
          isRenaming={pane.renamingId === query.id}
          renameDraft={pane.renameDraft}
          onCancelRename={pane.onCancelRename}
          onChangeRenameDraft={pane.onChangeRenameDraft}
          onCommitRename={pane.onCommitRename}
          onCopyQuery={pane.onCopyQuery}
          onDoubleClickQuery={pane.onDoubleClickQuery}
          onRemoveQuery={pane.onRemoveQuery}
          onStartRename={pane.onStartRename}
        />
      ))}
    </div>
  );
}

function PinnedQueryRenameInput({
  queryId,
  renameDraft,
  onCancelRename,
  onChangeRenameDraft,
  onCommitRename,
}: PinnedQueryRenameInputProps) {
  const onKeyDownRename = (event: PinnedQueryRenameKeyEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommitRename(queryId);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancelRename();
    }
  };

  return (
    <input
      autoFocus
      className="mdbc-tab-rename-input mdbc-pinned-query-rename-input"
      value={renameDraft}
      onChange={(event) => onChangeRenameDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onBlur={() => onCommitRename(queryId)}
      onKeyDown={onKeyDownRename}
      data-testid={`pinned-query-rename-${queryId}`}
    />
  );
}

function PinnedQueryRow({
  query,
  copied,
  isRenaming,
  renameDraft,
  onCancelRename,
  onChangeRenameDraft,
  onCommitRename,
  onCopyQuery,
  onDoubleClickQuery,
  onRemoveQuery,
  onStartRename,
}: PinnedQueryRowProps) {
  const onClickRename = (event: PinnedQueryButtonEvent) => {
    event.stopPropagation();
    onStartRename(query.id);
  };
  const onClickCopy = (event: PinnedQueryButtonEvent) => {
    event.stopPropagation();
    onCopyQuery(query.id);
  };
  const onClickRemove = (event: PinnedQueryButtonEvent) => {
    event.stopPropagation();
    onRemoveQuery(query.id);
  };

  return (
    <div
      onDoubleClick={() => {
        if (!isRenaming) onDoubleClickQuery(query.id);
      }}
      className="mdbc-hover-row mdbc-pinned-query-row"
      data-testid={`pinned-query-${query.id}`}
    >
      <div className="mdbc-pinned-query-head">
        <span className="mdbc-pinned-query-icon">
          <Icon name="pin" size={12} />
        </span>
        {isRenaming ? (
          <PinnedQueryRenameInput
            queryId={query.id}
            renameDraft={renameDraft}
            onCancelRename={onCancelRename}
            onChangeRenameDraft={onChangeRenameDraft}
            onCommitRename={onCommitRename}
          />
        ) : (
          <span className="mdbc-pinned-query-title" title={query.name}>
            {query.name}
          </span>
        )}
        <Tooltip label="Rename">
          <IconButton
            icon="pencil"
            label="Rename"
            variant="ghost"
            size={12}
            className="mdbc-pinned-query-icon-button"
            onClick={onClickRename}
            data-testid={`pinned-query-edit-${query.id}`}
          />
        </Tooltip>
        <Tooltip label={copied ? "Copied" : "Copy"}>
          <IconButton
            icon={copied ? "check" : "copy"}
            label={copied ? "Copied" : "Copy"}
            variant="ghost"
            size={12}
            className="mdbc-pinned-query-icon-button"
            onClick={onClickCopy}
            data-testid={`pinned-query-copy-${query.id}`}
          />
        </Tooltip>
        <Tooltip label="Remove">
          <IconButton
            icon="trash"
            label="Remove"
            variant="ghost"
            size={12}
            className="mdbc-pinned-query-icon-button"
            onClick={onClickRemove}
            data-testid={`pinned-query-delete-${query.id}`}
          />
        </Tooltip>
      </div>
      <pre
        className="mdbc-pinned-query-preview"
        title={query.text}
        data-testid={`pinned-query-preview-${query.id}`}
      >
        {highlightSql(queryPreview(query.text))}
      </pre>
    </div>
  );
}

export { PinnedQueriesContent };
