import { Icon } from "@shared/ui/Icon";
import { IconButton, Tooltip } from "@shared/ui";
import { useCsvTableView } from "./hooks";
import { CsvRawEditor } from "./components/CsvRawEditor";
import { CsvTable } from "./components/CsvTable";
import type { CsvTableViewProps } from "./types";

function CsvTableView({ tab }: CsvTableViewProps) {
  const view = useCsvTableView(tab);

  return (
    <div className="mdbc-csv-table-root">
      <div className="mdbc-runbar">
        <span className="mdbc-csv-table-info">
          <Icon name="table" size={13} />
          {tab.title}
        </span>
        <div className="mdbc-runbar-sep" />
        <span className="mdbc-csv-table-meta">
          {view.csvData.rows.length} rows · {view.csvData.headers.length} cols
        </span>
        <div className="mdbc-runbar-sep" />
        <button
          className={`mdbc-btn ghost${view.mode === "table" ? " active" : ""}`}
          onClick={view.onClickTableMode}
          data-testid="csv-mode-table"
        >
          Table
        </button>
        <button
          className={`mdbc-btn ghost${view.mode === "raw" ? " active" : ""}`}
          onClick={view.onClickRawMode}
          data-testid="csv-mode-raw"
        >
          Raw
        </button>
        <div className="mdbc-csv-table-toolbar-spacer" />
        {view.mode === "table" && (
          <Tooltip label="Add Row">
            <IconButton
              icon="plus"
              label="Add Row"
              variant="ghost"
              size={13}
              onClick={view.onClickAddRow}
              data-testid="csv-add-row"
            />
          </Tooltip>
        )}
      </div>
      {view.mode === "table" ? (
        <CsvTable
          data={view.csvData}
          onCellEdit={view.onCellEdit}
          onHeaderEdit={view.onHeaderEdit}
          onDeleteRow={view.onDeleteRow}
          fontSize={view.editorFontSize}
        />
      ) : (
        <CsvRawEditor tab={tab} fontSize={view.editorFontSize} />
      )}
    </div>
  );
}

export { CsvTableView };
