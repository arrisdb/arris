import { Field, FormRow } from "@shared/ui";
import { DbFilePicker } from "./dbFilePicker";
import type { FieldsProps } from "./types";

export function SQLiteFields({ config, patch }: FieldsProps) {
  return (
    <>
      <DbFilePicker
        value={config.filePath ?? ""}
        onChange={(v) => patch("filePath", v)}
        extension="db"
        browseTitle="Select a folder for the SQLite database"
        testId="sqlite-file-browse"
      />
      <FormRow label="Options">
        <Field value={config.options} onChange={(v) => patch("options", v)} placeholder="key1=val1&key2=val2" monospace />
      </FormRow>
    </>
  );
}
