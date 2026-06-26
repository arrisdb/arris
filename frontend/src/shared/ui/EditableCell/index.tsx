
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
        {display}
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
      {isPendingInsert && !value ? "default" : display}
    </span>
  );
}

function displayString(v: QueryValue | null): string {
  if (!v) return "";
  if (v.kind === "null") return "NULL";
  return String(v.value ?? "");
}

export {
  EditableCell,
};
