import { useSettingsStore } from "@shared/settings";
import { NumberStepper, Select } from "@shared/ui";
import {
  COMMA_POSITION_OPTIONS,
  CSV_DELIMITER_OPTIONS,
  INDENT_STYLE_OPTIONS,
  LOGICAL_OPERATOR_OPTIONS,
  MARKDOWN_LIST_MARKER_OPTIONS,
  SQL_CASE_OPTIONS,
} from "../../constants";
import { SettingsPane } from "../SettingsPane";
import { SettingRow } from "../SettingRow";
import { SettingsCheckbox } from "../SettingsCheckbox";
import { SettingsSection } from "../SettingsSection";

function FormatterPane() {
  const formatter = useSettingsStore((state) => state.formatter);
  const setFormatter = useSettingsStore((state) => state.setFormatter);
  const resetFormatter = useSettingsStore((state) => state.resetFormatter);
  const { sql, python, json, yaml, csv, markdown } = formatter;

  return (
    <SettingsPane onReset={resetFormatter}>
      <SettingsSection title="SQL">
        <SettingRow label="Keyword case" description="Case applied to SQL keywords">
          <Select
            value={sql.keywordCase}
            options={SQL_CASE_OPTIONS}
            onChange={(value) => setFormatter("sql", { keywordCase: value as never })}
            maxWidth={160}
          />
        </SettingRow>
        <SettingRow label="Identifier case" description="Case applied to table and column names">
          <Select
            value={sql.identifierCase}
            options={SQL_CASE_OPTIONS}
            onChange={(value) => setFormatter("sql", { identifierCase: value as never })}
            maxWidth={160}
          />
        </SettingRow>
        <SettingRow label="Data type case" description="Case applied to SQL data types">
          <Select
            value={sql.dataTypeCase}
            options={SQL_CASE_OPTIONS}
            onChange={(value) => setFormatter("sql", { dataTypeCase: value as never })}
            maxWidth={160}
          />
        </SettingRow>
        <SettingRow label="Function case" description="Case applied to SQL function names">
          <Select
            value={sql.functionCase}
            options={SQL_CASE_OPTIONS}
            onChange={(value) => setFormatter("sql", { functionCase: value as never })}
            maxWidth={160}
          />
        </SettingRow>
        <SettingRow label="Indent style" description="Alignment strategy for multiline SQL">
          <Select
            value={sql.indentStyle}
            options={INDENT_STYLE_OPTIONS}
            onChange={(value) => setFormatter("sql", { indentStyle: value as never })}
            maxWidth={160}
          />
        </SettingRow>
        <SettingRow label="Tab width" description="Columns inserted for each indent level">
          <NumberStepper
            value={sql.tabWidth}
            onChange={(value) => setFormatter("sql", { tabWidth: value })}
            min={1}
            max={8}
            step={1}
            aria-label="Tab width"
          />
        </SettingRow>
        <SettingRow label="Use tabs" description="Indent with tabs">
          <SettingsCheckbox
            checked={sql.useTabs}
            onChange={(checked) => setFormatter("sql", { useTabs: checked })}
            ariaLabel="Indent with tabs"
          />
        </SettingRow>
        <SettingRow label="Logical operator" description="Line break placement for AND and OR">
          <Select
            value={sql.logicalOperatorNewline}
            options={LOGICAL_OPERATOR_OPTIONS}
            onChange={(value) => setFormatter("sql", { logicalOperatorNewline: value as never })}
            maxWidth={240}
          />
        </SettingRow>
        <SettingRow label="Expression width" description="Wrap complex expressions beyond this width">
          <NumberStepper
            value={sql.expressionWidth}
            onChange={(value) => setFormatter("sql", { expressionWidth: value })}
            min={20}
            max={120}
            step={5}
            aria-label="Expression width"
          />
        </SettingRow>
        <SettingRow label="Lines between queries" description="Blank lines inserted between statements">
          <NumberStepper
            value={sql.linesBetweenQueries}
            onChange={(value) => setFormatter("sql", { linesBetweenQueries: value })}
            min={0}
            max={5}
            step={1}
            aria-label="Lines between queries"
          />
        </SettingRow>
        <SettingRow
          label="Dense operators"
          description="Remove spaces around operators"
          testId="dense-operators-setting"
        >
          <SettingsCheckbox
            checked={sql.denseOperators}
            onChange={(checked) => setFormatter("sql", { denseOperators: checked })}
            ariaLabel="Dense operators"
          />
        </SettingRow>
        <SettingRow label="Semicolon" description="Place semicolon on its own line">
          <SettingsCheckbox
            checked={sql.newlineBeforeSemicolon}
            onChange={(checked) => setFormatter("sql", { newlineBeforeSemicolon: checked })}
            ariaLabel="Newline before semicolon"
          />
        </SettingRow>
        <SettingRow label="Comma position" description="Place commas at the end or start of lines">
          <Select
            value={sql.commaPosition}
            options={COMMA_POSITION_OPTIONS}
            onChange={(value) => setFormatter("sql", { commaPosition: value as never })}
            maxWidth={240}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Python">
        <SettingRow label="Indent width" description="Spaces inserted for each indent level">
          <NumberStepper
            value={python.indentWidth}
            onChange={(value) => setFormatter("python", { indentWidth: value })}
            min={1}
            max={8}
            step={1}
            aria-label="Python indent width"
          />
        </SettingRow>
        <SettingRow label="Max blank lines" description="Collapse runs of blank lines beyond this">
          <NumberStepper
            value={python.maxBlankLines}
            onChange={(value) => setFormatter("python", { maxBlankLines: value })}
            min={0}
            max={5}
            step={1}
            aria-label="Python max blank lines"
          />
        </SettingRow>
        <SettingRow label="Trim trailing whitespace" description="Strip spaces at the end of lines">
          <SettingsCheckbox
            checked={python.trimTrailingWhitespace}
            onChange={(checked) => setFormatter("python", { trimTrailingWhitespace: checked })}
            ariaLabel="Trim trailing whitespace"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="CSV">
        <SettingRow label="Delimiter" description="Field separator used when reformatting">
          <Select
            value={csv.delimiter}
            options={CSV_DELIMITER_OPTIONS}
            onChange={(value) => setFormatter("csv", { delimiter: value as never })}
            maxWidth={200}
          />
        </SettingRow>
        <SettingRow label="Trim fields" description="Strip surrounding whitespace from each field">
          <SettingsCheckbox
            checked={csv.trimFields}
            onChange={(checked) => setFormatter("csv", { trimFields: checked })}
            ariaLabel="Trim CSV fields"
          />
        </SettingRow>
        <SettingRow label="Quote all fields" description="Wrap every field in double quotes">
          <SettingsCheckbox
            checked={csv.quoteAllFields}
            onChange={(checked) => setFormatter("csv", { quoteAllFields: checked })}
            ariaLabel="Quote all CSV fields"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="JSON">
        <SettingRow label="Indent width" description="Spaces inserted for each indent level">
          <NumberStepper
            value={json.indentWidth}
            onChange={(value) => setFormatter("json", { indentWidth: value })}
            min={1}
            max={8}
            step={1}
            aria-label="JSON indent width"
          />
        </SettingRow>
        <SettingRow label="Use tabs" description="Indent with tabs instead of spaces">
          <SettingsCheckbox
            checked={json.useTabs}
            onChange={(checked) => setFormatter("json", { useTabs: checked })}
            ariaLabel="Indent JSON with tabs"
          />
        </SettingRow>
        <SettingRow label="Sort keys" description="Order object keys alphabetically">
          <SettingsCheckbox
            checked={json.sortKeys}
            onChange={(checked) => setFormatter("json", { sortKeys: checked })}
            ariaLabel="Sort JSON keys"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="YAML">
        <SettingRow label="Indent width" description="Spaces inserted for each indent level">
          <NumberStepper
            value={yaml.indentWidth}
            onChange={(value) => setFormatter("yaml", { indentWidth: value })}
            min={1}
            max={8}
            step={1}
            aria-label="YAML indent width"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Markdown">
        <SettingRow label="List marker" description="Bullet character for unordered lists">
          <Select
            value={markdown.listMarker}
            options={MARKDOWN_LIST_MARKER_OPTIONS}
            onChange={(value) => setFormatter("markdown", { listMarker: value as never })}
            maxWidth={200}
          />
        </SettingRow>
        <SettingRow label="Trim trailing whitespace" description="Strip spaces at the end of lines">
          <SettingsCheckbox
            checked={markdown.trimTrailingWhitespace}
            onChange={(checked) => setFormatter("markdown", { trimTrailingWhitespace: checked })}
            ariaLabel="Trim markdown trailing whitespace"
          />
        </SettingRow>
      </SettingsSection>
    </SettingsPane>
  );
}

export { FormatterPane };
