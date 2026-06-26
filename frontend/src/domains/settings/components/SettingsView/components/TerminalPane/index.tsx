import { useSettingsStore } from "@shared/settings";
import { DEFAULT_EDITOR_FONT_VALUE } from "@shared/ui/utils/editorFont";
import { NumberStepper, Select } from "@shared/ui";
import { Icon } from "@shared/ui/Icon";
import { useTerminalPane } from "../../hooks";
import { SettingsPane } from "../SettingsPane";
import { SettingRow } from "../SettingRow";

function TerminalPane() {
  const {
    fontOptions,
    onBrowseShell,
    onFontFamilyChange,
    onShellChange,
    selectedShell,
    setTerminalFontSize,
    shellOptions,
    terminalFontFamily,
    terminalFontSize,
  } = useTerminalPane();
  const resetTerminal = useSettingsStore((state) => state.resetTerminal);

  return (
    <SettingsPane onReset={resetTerminal}>
      <SettingRow label="Default Shell" description="Shell used for new terminal sessions">
        <div className="mdbc-shell-control">
          <Select
            value={selectedShell}
            options={shellOptions}
            onChange={onShellChange}
            maxWidth={260}
            title="Default Shell"
            data-testid="terminal-shell-select"
          />
          <button
            type="button"
            className="mdbc-btn-icon"
            onClick={onBrowseShell}
            title="Browse for a shell executable"
            aria-label="Browse for a shell executable"
            data-testid="terminal-custom-shell-browse"
          >
            <Icon name="folder" size={14} />
          </button>
        </div>
      </SettingRow>
      <SettingRow label="Font family" description="Font used by terminal sessions">
        <Select
          value={terminalFontFamily ?? DEFAULT_EDITOR_FONT_VALUE}
          options={fontOptions}
          onChange={onFontFamilyChange}
          maxWidth={220}
          title="Terminal font family"
          data-testid="terminal-font-family-select"
        />
      </SettingRow>
      <SettingRow label="Font size" description="Text size inside terminal sessions">
        <NumberStepper
          value={terminalFontSize}
          onChange={setTerminalFontSize}
          min={10}
          max={20}
          step={0.5}
          aria-label="Terminal font size"
        />
      </SettingRow>
    </SettingsPane>
  );
}

export { TerminalPane };
