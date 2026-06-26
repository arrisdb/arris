import type { CSSProperties } from "react";
import { useRef, useState } from "react";
import { IconButton } from "@shared/ui/IconButton";
import "./index.css";
import type {
  EditableTableColumn,
  EditableTableEditing,
  EditableTableProps,
  EditableTableRow,
} from "./types";

function emptyDraft(columns: EditableTableColumn[]): EditableTableRow {
  const draft: EditableTableRow = {};
  for (const col of columns) draft[col.key] = "";
  return draft;
}

function trimDraft(columns: EditableTableColumn[], draft: EditableTableRow): EditableTableRow {
  const next: EditableTableRow = {};
  for (const col of columns) next[col.key] = (draft[col.key] ?? "").trim();
  return next;
}

function isDraftEmpty(columns: EditableTableColumn[], draft: EditableTableRow): boolean {
  return columns.every((col) => (draft[col.key] ?? "").trim() === "");
}

// A JetBrains-style editable table: a toolbar (add / remove / edit) above a
// bordered grid with a header row and selectable body rows. The owner holds the
// row data; this component owns only transient selection and inline-edit state,
// emitting the full next row set through `onChange`. Reusable for any
// string-cell table (path variables, env vars, folder lists, ...).
function EditableTable({ columns, rows, onChange, emptyLabel, testId }: EditableTableProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditableTableEditing>(null);
  const [draft, setDraft] = useState<EditableTableRow>({});
  const editRowRef = useRef<HTMLDivElement>(null);

  const tid = (suffix: string) => (testId ? `${testId}-${suffix}` : undefined);

  const beginAdd = () => {
    setSelected(null);
    setDraft(emptyDraft(columns));
    setEditing("new");
  };

  const beginEdit = () => {
    if (selected == null) return;
    setDraft({ ...rows[selected] });
    setEditing(selected);
  };

  const removeSelected = () => {
    if (selected == null) return;
    onChange(rows.filter((_, i) => i !== selected));
    setSelected(null);
    setEditing(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft({});
  };

  const commitEdit = () => {
    if (editing == null) return;
    if (isDraftEmpty(columns, draft)) {
      cancelEdit();
      return;
    }
    const cleaned = trimDraft(columns, draft);
    if (editing === "new") {
      onChange([...rows, cleaned]);
    } else {
      onChange(rows.map((row, i) => (i === editing ? cleaned : row)));
    }
    cancelEdit();
  };

  // Commit when focus leaves the whole edit row, so clicking elsewhere keeps
  // the value (matching the native table feel). Moving between cells of the
  // same row keeps editing.
  const onRowBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && editRowRef.current?.contains(next)) return;
    commitEdit();
  };

  const renderEditRow = (rowKey: string) => (
    <div
      key={rowKey}
      ref={editRowRef}
      className="mdbc-editable-table-row editing"
      style={{ "--mdbc-et-cols": columns.length } as CSSProperties}
      onBlur={onRowBlur}
      data-testid={tid("edit-row")}
    >
      {columns.map((col, colIndex) => (
        <input
          key={col.key}
          type="text"
          // focus the first cell so the user can type immediately after add/edit.
          autoFocus={colIndex === 0}
          className="mdbc-editable-table-input"
          value={draft[col.key] ?? ""}
          placeholder={col.placeholder}
          spellCheck={false}
          aria-label={col.label}
          onChange={(event) => setDraft((prev) => ({ ...prev, [col.key]: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitEdit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelEdit();
            }
          }}
          data-testid={tid(`input-${col.key}`)}
        />
      ))}
    </div>
  );

  const showEmpty = rows.length === 0 && editing !== "new";

  return (
    <div className="mdbc-editable-table" data-testid={testId}>
      <div className="mdbc-editable-table-toolbar">
        <IconButton
          icon="plus"
          label="Add row"
          variant="ghost"
          onClick={beginAdd}
          data-testid={tid("add")}
        />
        <IconButton
          icon="minus"
          label="Remove selected row"
          variant="ghost"
          onClick={removeSelected}
          disabled={selected == null}
          data-testid={tid("remove")}
        />
        <IconButton
          icon="pencil"
          label="Edit selected row"
          variant="ghost"
          onClick={beginEdit}
          disabled={selected == null}
          data-testid={tid("edit")}
        />
      </div>
      <div className="mdbc-editable-table-grid">
        <div
          className="mdbc-editable-table-row head"
          style={{ "--mdbc-et-cols": columns.length } as CSSProperties}
        >
          {columns.map((col) => (
            <div key={col.key} className="mdbc-editable-table-cell head">
              {col.label}
            </div>
          ))}
        </div>
        <div className="mdbc-editable-table-body">
          {showEmpty && (
            <div className="mdbc-editable-table-empty" data-testid={tid("empty")}>
              {emptyLabel ?? "No rows"}
            </div>
          )}
          {rows.map((row, rowIndex) =>
            editing === rowIndex ? (
              renderEditRow(`edit-${rowIndex}`)
            ) : (
              <div
                key={rowIndex}
                className={`mdbc-editable-table-row${selected === rowIndex ? " selected" : ""}`}
                style={{ "--mdbc-et-cols": columns.length } as CSSProperties}
                onClick={() => setSelected(rowIndex)}
                onDoubleClick={() => {
                  setSelected(rowIndex);
                  setDraft({ ...row });
                  setEditing(rowIndex);
                }}
                data-testid={tid(`row-${rowIndex}`)}
              >
                {columns.map((col) => (
                  <div key={col.key} className="mdbc-editable-table-cell">
                    {row[col.key] ?? ""}
                  </div>
                ))}
              </div>
            ),
          )}
          {editing === "new" && renderEditRow("edit-new")}
        </div>
      </div>
    </div>
  );
}

export { EditableTable };
