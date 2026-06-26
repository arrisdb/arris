import type { SettingsCheckboxProps } from "../../types";

function SettingsCheckbox({
  checked,
  onChange,
  ariaLabel,
}: SettingsCheckboxProps) {
  return (
    <input
      type="checkbox"
      className="mdbc-checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      aria-label={ariaLabel}
    />
  );
}

export { SettingsCheckbox };
