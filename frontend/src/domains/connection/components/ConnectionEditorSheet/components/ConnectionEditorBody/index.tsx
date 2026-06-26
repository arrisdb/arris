import { Field } from "@shared/ui";
import { DatabaseKindIcon } from "@domains/connection/utils/databaseKindIcon";
import type { ConnectionEditorSheetViewModel } from "../../types";

function ConnectionEditorBody({ pane }: { pane: ConnectionEditorSheetViewModel }) {
  const Fields = pane.fieldsComponent;

  return (
    <>
      <div className="mdbc-connection-editor-driver-row">
        <DatabaseKindIcon kind={pane.config.kind} size={36} />
        <div className="mdbc-connection-editor-driver-field">
          <Field
            value={pane.config.name}
            onChange={(value) => pane.patch("name", value)}
            placeholder="Connection name"
          />
        </div>
      </div>

      <Fields
        config={pane.config}
        patch={pane.patch}
        setConfig={pane.setConfig}
        showSsh={pane.showSsh}
        setShowSsh={pane.setShowSsh}
        uri={pane.uri}
        onUriChange={pane.onChangeUri}
      />

      {pane.error && (
        <div className="mdbc-connection-editor-error-banner">
          {pane.error}
        </div>
      )}
    </>
  );
}

export { ConnectionEditorBody };
