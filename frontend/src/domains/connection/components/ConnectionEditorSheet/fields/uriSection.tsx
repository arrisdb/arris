import type { FieldsProps } from "./types";
import { Field, FormRow } from "@shared/ui";

type Props = Pick<FieldsProps, "config" | "uri" | "onUriChange">;

export function UriSection({ config, uri, onUriChange }: Props) {
  return (
    <div className="mdbc-uri-section" >
      <FormRow label="URL">
        <div className="mdbc-uri-field" >
          <Field
            value={uri}
            onChange={onUriChange}
            monospace
            placeholder={`${config.kind}://user:pass@host:port/db`}
          />
          <div className="mdbc-uri-help" >
            Overrides settings above
          </div>
        </div>
      </FormRow>
    </div>
  );
}
