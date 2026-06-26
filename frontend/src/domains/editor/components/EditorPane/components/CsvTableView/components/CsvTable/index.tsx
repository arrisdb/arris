import { IconButton } from "@shared/ui";
import { useCsvTable, useInlineEditCell } from "../../hooks";
import type { CsvTableProps, InlineEditCellProps } from "../../types";
import { csvCellEditStateStyle, csvTableFontSizeStyle } from "../../utils";

function CsvTable({ data, onCellEdit, onHeaderEdit, onDeleteRow, fontSize }: CsvTableProps) {
  const table = useCsvTable(data.rows.length);

  if (data.headers.length === 0) {
    return (
      <div className="mdbc-csv-table-empty" data-testid="csv-empty">
        Empty CSV
      </div>
    );
  }

  return (
    <div className="mdbc-csv-table-scroll" ref={table.parentRef} data-testid="csv-table-container">
      <table className="mdbc-table mdbc-csv-table-font-size" style={csvTableFontSizeStyle(fontSize)}>
        <thead>
          <tr>
            <th className="mdbc-csv-table-row-number-header">#</th>
            {data.headers.map((h, i) => (
              <th key={i}>
                <InlineEditCell
                  value={h}
                  onCommit={(val) => onHeaderEdit(i, val)}
                  testId={`csv-header-${i}`}
                />
              </th>
            ))}
            <th className="mdbc-csv-table-action-header" />
          </tr>
        </thead>
        <tbody>
          {table.rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const rowIdx = virtualRow.index;
            const row = data.rows[rowIdx];
            return (
              <tr
                key={rowIdx}
                className={table.selectedRow === rowIdx ? "selected" : ""}
                onClick={() => table.onClickRow(rowIdx)}
                data-testid={`csv-row-${rowIdx}`}
              >
                <td className="rownum">{rowIdx + 1}</td>
                {row.map((cell, ci) => (
                  <td key={ci}>
                    <InlineEditCell
                      value={cell}
                      onCommit={(val) => onCellEdit(rowIdx, ci, val)}
                      testId={`csv-cell-${rowIdx}-${ci}`}
                    />
                  </td>
                ))}
                <td>
                  <IconButton
                    icon="trash"
                    label={`Delete row ${rowIdx + 1}`}
                    variant="ghost"
                    size={11}
                    className="mdbc-csv-table-icon-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeleteRow(rowIdx);
                    }}
                    data-testid={`csv-delete-row-${rowIdx}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InlineEditCell({ value, onCommit, testId }: InlineEditCellProps) {
  const cell = useInlineEditCell(value, onCommit);

  return (
    <input
      className="mdbc-csv-cell-input mdbc-csv-cell-edit-state"
      ref={cell.inputRef}
      value={cell.editing ? cell.draft : value}
      readOnly={!cell.editing}
      placeholder="(empty)"
      onChange={cell.onChangeDraft}
      onDoubleClick={cell.onDoubleClickStartEdit}
      onBlur={cell.onBlurCommit}
      onKeyDown={cell.onKeyDownEdit}
      data-testid={testId}
      style={csvCellEditStateStyle(cell.editing)}
    />
  );
}

export { CsvTable };
