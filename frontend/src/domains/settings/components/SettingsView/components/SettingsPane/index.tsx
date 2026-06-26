import { Btn } from "@shared/ui";
import type { SettingsPaneProps } from "../../types";

function SettingsPane({ children, onReset }: SettingsPaneProps) {
  return (
    <div className="mdbc-settings-list">
      {onReset && (
        <div className="mdbc-settings-pane-actions">
          <Btn onClick={onReset}>Reset to Default</Btn>
        </div>
      )}
      {children}
    </div>
  );
}

export { SettingsPane };
