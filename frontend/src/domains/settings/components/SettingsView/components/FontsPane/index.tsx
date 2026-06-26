import { useSettingsStore } from "@shared/settings";
import { DEFAULT_EDITOR_FONT_VALUE } from "@shared/ui/utils/editorFont";
import { NumberStepper, Select } from "@shared/ui";
import { useFontsPane } from "../../hooks";
import { SettingsPane } from "../SettingsPane";
import { SettingRow } from "../SettingRow";

function FontsPane() {
  const {
    editorFontFamily,
    editorSize,
    fontOptions,
    iconSize,
    onEditorFontFamilyChange,
    onUiFontFamilyChange,
    setEditor,
    setIconSize,
    setUi,
    uiFontFamily,
    uiSize,
  } = useFontsPane();
  const resetFonts = useSettingsStore((state) => state.resetFonts);

  return (
    <SettingsPane onReset={resetFonts}>
      <SettingRow label="UI font family" description="Font used across the app interface">
        <Select
          value={uiFontFamily ?? DEFAULT_EDITOR_FONT_VALUE}
          options={fontOptions}
          onChange={onUiFontFamilyChange}
          maxWidth={220}
          title="UI font family"
          data-testid="ui-font-family-select"
        />
      </SettingRow>
      <SettingRow label="Editor font family" description="Font used by query and file editors">
        <Select
          value={editorFontFamily ?? DEFAULT_EDITOR_FONT_VALUE}
          options={fontOptions}
          onChange={onEditorFontFamilyChange}
          maxWidth={220}
          title="Editor font family"
          data-testid="editor-font-family-select"
        />
      </SettingRow>
      <SettingRow label="UI text size" description="Scale app chrome and labels">
        <NumberStepper
          value={uiSize}
          onChange={setUi}
          min={11}
          max={20}
          step={0.5}
          aria-label="UI text size"
        />
      </SettingRow>
      <SettingRow label="Icon size" description="Scale toolbar and pane icons">
        <NumberStepper
          value={iconSize}
          onChange={setIconSize}
          min={10}
          max={22}
          step={1}
          aria-label="Icon size"
        />
      </SettingRow>
      <SettingRow label="Editor size" description="Text size inside file and SQL editors">
        <NumberStepper
          value={editorSize}
          onChange={setEditor}
          min={10}
          max={20}
          step={0.5}
          aria-label="Editor size"
        />
      </SettingRow>
    </SettingsPane>
  );
}

export { FontsPane };
