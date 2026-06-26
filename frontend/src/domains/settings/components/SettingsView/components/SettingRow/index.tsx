import type { SettingRowProps } from "../../types";

function SettingRow({
  label,
  description,
  children,
  testId,
}: SettingRowProps) {
  return (
    <div className="mdbc-settings-row" data-testid={testId}>
      <div className="mdbc-settings-row-copy">
        <div className="mdbc-settings-row-label">{label}</div>
        <div className="mdbc-settings-row-description">{description}</div>
      </div>
      <div className="mdbc-settings-row-control">{children}</div>
    </div>
  );
}

export { SettingRow };
