import { useSettingsStore } from "@shared/settings";
import { Select } from "@shared/ui";
import {
  COLOR_SCHEME_OPTIONS,
  SYNTAX_TOKENS,
  THEME_OPTIONS,
} from "../../constants";
import { SettingsPane } from "../SettingsPane";
import { SettingRow } from "../SettingRow";
import { SettingsCheckbox } from "../SettingsCheckbox";
import { SettingsSection } from "../SettingsSection";
import { SyntaxColorSwatch } from "../SyntaxColorSwatch";

function AppearancePane() {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const editorColorScheme = useSettingsStore((state) => state.editorColorScheme);
  const setEditorColorScheme = useSettingsStore((state) => state.setEditorColorScheme);
  const syntaxOverrides = useSettingsStore((state) => state.syntaxOverrides);
  const setSyntaxOverride = useSettingsStore((state) => state.setSyntaxOverride);
  const indentGuides = useSettingsStore((state) => state.indentGuides);
  const setIndentGuides = useSettingsStore((state) => state.setIndentGuides);
  const statementBorder = useSettingsStore((state) => state.statementBorder);
  const setStatementBorder = useSettingsStore((state) => state.setStatementBorder);
  const resetAppearance = useSettingsStore((state) => state.resetAppearance);
  return (
    <SettingsPane onReset={resetAppearance}>
      <SettingRow label="Theme" description="Choose a color theme for the IDE">
        <Select
          value={theme}
          onChange={(value) => setTheme(value as never)}
          options={THEME_OPTIONS}
          maxWidth={200}
        />
      </SettingRow>
      <SettingRow
        label="Editor color scheme"
        description="Syntax highlighting palette for the code editor, independent of the app theme"
      >
        <Select
          value={editorColorScheme}
          onChange={setEditorColorScheme}
          options={COLOR_SCHEME_OPTIONS}
          maxWidth={200}
          data-testid="editor-color-scheme-select"
        />
      </SettingRow>
      <SettingRow
        label="Indent guides"
        description="Draw vertical lines marking each indentation level in the editor"
        testId="indent-guides-toggle"
      >
        <SettingsCheckbox
          checked={indentGuides}
          onChange={setIndentGuides}
          ariaLabel="Show editor indent guides"
        />
      </SettingRow>
      <SettingRow
        label="Statement border"
        description="Outline the SQL statement at the cursor with a box"
        testId="statement-border-toggle"
      >
        <SettingsCheckbox
          checked={statementBorder}
          onChange={setStatementBorder}
          ariaLabel="Show statement border"
        />
      </SettingRow>
      <SettingsSection
        title="Customize syntax colors"
        description="Override the editor's default highlight color for each token type"
      >
        <div className="mdbc-syntax-swatch-grid">
          {SYNTAX_TOKENS.map((token) => (
            <SyntaxColorSwatch
              key={token.id}
              token={token.id}
              label={token.label}
              value={syntaxOverrides[token.id]}
              onChange={(color) => setSyntaxOverride(token.id, color)}
            />
          ))}
        </div>
      </SettingsSection>
    </SettingsPane>
  );
}

export { AppearancePane };
