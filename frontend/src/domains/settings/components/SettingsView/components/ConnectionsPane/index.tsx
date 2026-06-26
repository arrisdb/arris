import { useSettingsStore } from "@shared/settings";
import { Select } from "@shared/ui";
import { CONNECTION_AUTO_REFRESH_OPTIONS } from "../../constants";
import { SettingsPane } from "../SettingsPane";
import { SettingRow } from "../SettingRow";

function ConnectionsPane() {
  const connectionAutoRefreshMs = useSettingsStore((state) => state.connectionAutoRefreshMs);
  const setConnectionAutoRefreshMs = useSettingsStore(
    (state) => state.setConnectionAutoRefreshMs,
  );
  return (
    <SettingsPane>
      <SettingRow
        label="Auto-refresh"
        description="Periodically refresh connection schemas so the sidebar reflects tables created or dropped outside Arris"
        testId="connection-auto-refresh"
      >
        <Select
          value={String(connectionAutoRefreshMs)}
          onChange={(value) => setConnectionAutoRefreshMs(Number(value))}
          options={CONNECTION_AUTO_REFRESH_OPTIONS}
          maxWidth={200}
          data-testid="connection-auto-refresh-select"
        />
      </SettingRow>
    </SettingsPane>
  );
}

export { ConnectionsPane };
