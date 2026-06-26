import { Field, FormRow, PathField } from "@shared/ui";
import { splitFilePath, joinFilePath } from "./dbFilePicker.utils";

// Folder + filename picker for embedded file databases (SQLite, DuckDB). The
// browse button opens a directory dialog; once a folder is chosen a separate
// "Filename" row appears so the user names the database file to create.
function DbFilePicker({
  value,
  onChange,
  extension,
  browseTitle,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  extension: string;
  browseTitle: string;
  testId: string;
}) {
  const { dir, name } = splitFilePath(value);
  const showFilename = dir.length > 0;

  return (
    <>
      <FormRow label="Folder">
        <PathField
          value={dir}
          onChange={(d) => onChange(joinFilePath(d, name))}
          directory
          placeholder="/absolute/folder"
          title={browseTitle}
          testId={testId}
        />
      </FormRow>
      {showFilename && (
        <FormRow label="Filename">
          <Field
            value={name}
            onChange={(n) => onChange(joinFilePath(dir, n))}
            placeholder={`mydb.${extension}`}
            monospace
          />
        </FormRow>
      )}
    </>
  );
}

export { DbFilePicker };
