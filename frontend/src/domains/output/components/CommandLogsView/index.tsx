import type { RefObject } from "react";
import { PaneContextMenuSurface } from "@shared/ui/ContextMenu";
import { Icon } from "@shared/ui/Icon";
import { SearchInput, Select } from "@shared/ui";
import { useSettingsStore } from "@shared/settings";
import { STATUS_FILTER_OPTIONS, commandLogsContextMenuItems } from "./constants";
import { useCommandLogsView } from "./hooks";
import { CommandLogEntry } from "./components/CommandLogEntry";
import { durationLabel, filterEntries, formatTimestamp } from "./utils";
import type { StatusFilter } from "./types";
import "./index.css";

function CommandLogsView() {
  const {
    entries,
    scrollRef,
    filterText,
    setFilterText,
    statusFilter,
    setStatusFilter,
    onClickClear,
  } = useCommandLogsView();
  const hideBottomPane = useSettingsStore((state) => state.hideBottomPane);
  // Newest run on top.
  const visible = filterEntries(entries, filterText, statusFilter)
    .sort((a, b) => b.startedAt - a.startedAt);

  return (
    <div className="mdbc-cmdlog">
      <div className="mdbc-cmdlog-toolbar" data-testid="command-logs-toolbar">
        <div className="mdbc-cmdlog-search">
          <SearchInput
            value={filterText}
            onChange={setFilterText}
            placeholder="Filter logs…"
          />
        </div>
        <Select
          value={statusFilter}
          options={STATUS_FILTER_OPTIONS}
          onChange={(value) => setStatusFilter(value as StatusFilter)}
          maxWidth={140}
        />
        <button
          type="button"
          className="mdbc-cmdlog-tool"
          title="Clear logs"
          onClick={onClickClear}
        >
          <Icon name="trash" size={14} />
        </button>
        <button
          type="button"
          className="mdbc-cmdlog-tool"
          title="Collapse panel"
          data-testid="command-logs-close"
          onClick={hideBottomPane}
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      {visible.length === 0 ? (
        <PaneContextMenuSurface
          className="mdbc-placeholder"
          context={null}
          getItems={commandLogsContextMenuItems}
        >
          No command logs yet.
        </PaneContextMenuSurface>
      ) : (
        <PaneContextMenuSurface
          className="mdbc-cmdlog-list"
          context={null}
          getItems={commandLogsContextMenuItems}
          surfaceRef={scrollRef as RefObject<HTMLDivElement>}
        >
          {visible.map((entry, index) => (
            <CommandLogEntry
              key={entry.id}
              command={entry.command}
              status={entry.status}
              durationLabel={durationLabel(entry)}
              timestampLabel={formatTimestamp(entry.startedAt)}
              nodes={entry.nodes}
              rawOutput={entry.rawOutput}
              rawQuery={entry.kind === "sql" ? entry.command : undefined}
              tabTitle={entry.tabTitle}
              defaultExpanded={index === 0}
            />
          ))}
        </PaneContextMenuSurface>
      )}
    </div>
  );
}

export {
  CommandLogsView,
};
