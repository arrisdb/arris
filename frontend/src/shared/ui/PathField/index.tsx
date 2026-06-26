import { useCallback } from "react";
import type { CSSProperties } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Field } from "../Field";
import { Icon } from "../Icon";

type DialogFilter = { name: string; extensions: string[] };

type OpenOptions = {
  directory: boolean;
  multiple: false;
  title?: string;
  filters?: DialogFilter[];
};

function PathField({
  value,
  onChange,
  placeholder,
  monospace = true,
  directory = false,
  filters,
  title,
  testId = "path-field-browse",
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  monospace?: boolean;
  directory?: boolean;
  filters?: DialogFilter[];
  title?: string;
  testId?: string;
  style?: CSSProperties;
}) {
  const onClickBrowse = useCallback(async () => {
    const options: OpenOptions = { directory, multiple: false };
    if (title) options.title = title;
    if (!directory && filters) options.filters = filters;
    const picked = await openDialog(options);
    if (typeof picked === "string") onChange(picked);
  }, [directory, filters, title, onChange]);

  return (
    <div className="mdbc-path-field">
      <Field
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        monospace={monospace}
        style={style}
      />
      <button
        type="button"
        className="mdbc-btn-icon"
        onClick={onClickBrowse}
        title="Browse…"
        aria-label="Browse"
        data-testid={testId}
      >
        <Icon name="folder" size={14} />
      </button>
    </div>
  );
}

export { PathField };
export type { DialogFilter };
