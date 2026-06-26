import type { CSSProperties, ChangeEvent } from "react";

function Field({
  value,
  onChange,
  type = "text",
  placeholder,
  monospace = false,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  monospace?: boolean;
  style?: CSSProperties;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      className={`mdbc-field${monospace ? " mono" : ""}`}
      style={style}
    />
  );
}

export {
  Field,
};
