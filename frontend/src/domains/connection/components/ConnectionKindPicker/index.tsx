import { useState } from "react";
import { Sheet, SearchInput } from "@shared/ui";
import { DatabaseKindIcon } from "@domains/connection/utils/databaseKindIcon";
import { pickerKindGroups } from "./utils";
import type { ConnectionKindPickerProps } from "./types";
import type { DatabaseKind } from "../CombinedConnectionsTree/types";
import "./index.css";

function ConnectionKindPicker({ open, onClose, onSelect }: ConnectionKindPickerProps) {
  const [query, setQuery] = useState("");
  const groups = pickerKindGroups(query);

  const onClosePicker = () => {
    setQuery("");
    onClose();
  };

  const onClickKind = (kind: DatabaseKind) => {
    setQuery("");
    onSelect(kind);
  };

  return (
    <Sheet
      open={open}
      onClose={onClosePicker}
      title="New connection"
      width={480}
      closeOnBackdropClick={false}
    >
      <div className="mdbc-connection-picker">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search databases…"
          testId="connection-picker-search"
        />
        <div data-testid="connection-picker-list">
          {groups.map((group) => (
          <div className="mdbc-connection-picker-group" key={group.title}>
            <div className="mdbc-connection-picker-group-title">{group.title}</div>
            <div className="mdbc-connection-picker-grid">
              {group.options.map((option) => (
                <button
                  key={option.kind}
                  className="mdbc-connection-picker-option"
                  onClick={() => onClickKind(option.kind)}
                  data-testid={`connection-picker-option-${option.kind}`}
                >
                  <DatabaseKindIcon kind={option.kind} size={24} />
                  <span className="mdbc-connection-picker-option-name">{option.displayName}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
          {groups.length === 0 && <div className="mdbc-empty">No matches</div>}
        </div>
      </div>
    </Sheet>
  );
}

export { ConnectionKindPicker };
