
import { useEffect, useRef, useState } from "react";
import type { QueryValue, QueryValueKind } from "@shared";
import { coerceQueryValue } from "@shared";

interface Props {
  value: QueryValue | null;
  targetKind?: QueryValueKind;
  staged?: boolean;
  isPendingInsert?: boolean;
  readOnly?: boolean;
  onCommit: (next: QueryValue) => void;
}

function EditableCell({
  value,
  targetKind,
  staged,
  isPendingInsert,
  readOnly,
  onCommit,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const display = displayString(value);
  const preview = previewString(display);
  const isNull = value?.kind === "null";

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    if (draft === display) return;
    if (draft === "" && isPendingInsert) {
      // empty → keep as default sentinel
      onCommit({ kind: "null" });
      return;
    }
    const kind = targetKind ?? value?.kind ?? "text";
    onCommit(coerceQueryValue(draft, kind));
  }

  if (readOnly) {
    return (
      <span className="mdbc-editable-cell-readonly-value"
        style={{ "--mdbc-editable-cell-readonly-color": isNull ? "var(--m-fg-4)" : "var(--m-fg, #f5f5f7)", "--mdbc-editable-cell-readonly-font-style": isNull ? "italic" : "normal" } as any}
      >
        {preview}
      </span>
    );
  }

  if (editing) {
    return (
      <input className="mdbc-editable-cell-input"
        ref={inputRef}
        value={draft}
        size={1}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}

      />
    );
  }

  return (
    <span
      onDoubleClick={() => {
        setDraft(isNull ? "" : display);
        setEditing(true);
      }}
      className={[[staged ? "staged" : "", "mdbc-editable-cell-display"].filter(Boolean).join(" "), "mdbc-editable-cell-editable-value"].filter(Boolean).join(" ")}
      style={{ "--mdbc-editable-cell-editable-color": isNull ? "var(--m-fg-4)" : "var(--m-fg, #f5f5f7)", "--mdbc-editable-cell-editable-font-style": isNull ? "italic" : "normal" } as any}
    >
      {isPendingInsert && !value ? "default" : preview}
    </span>
  );
}

function displayString(v: QueryValue | null): string {
  if (!v) return "";
  if (v.kind === "null") return "NULL";
  return String(v.value ?? "");
}

// Cap on the single-line preview rendered in a table cell. The full value stays
// in `display` (used for editing) and in the row detail pane; this only bounds
// what the grid shows so a multi-KB JSON / long text cell renders a readable
// truncated string ("{"id":1,"name":...…") instead of a bare ellipsis.
const MAX_PREVIEW_CHARS = 500;

function previewString(s: string): string {
  // Fast path: short, single-line value needs no transformation.
  if (s.length <= MAX_PREVIEW_CHARS && !/[\n\r\t]/.test(s)) return s;
  const collapsed = s.replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_PREVIEW_CHARS
    ? collapsed.slice(0, MAX_PREVIEW_CHARS) + "…"
    : collapsed;
}

export {
  EditableCell,
};
