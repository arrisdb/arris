import { useState } from "react";
import { AGENT_INPUT_PLACEHOLDER } from "../../constants";

function InputBar({
  available,
  unavailableMessage,
  onSend,
}: {
  available: boolean | null;
  unavailableMessage: string;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  // A null status means the check hasn't resolved yet, so don't block on unknowns.
  // Auth is NOT pre-checked: if the CLI is signed out, the turn runs and its error
  // (e.g. "not logged in") streams back into the message list.
  const unavailable = available === false;
  const submit = () => {
    if (!value.trim()) return;
    onSend(value);
    setValue("");
  };
  return (
    <div className="mdbc-agent-input">
      {unavailable ? (
        <div className="mdbc-agent-unavailable">⚠ {unavailableMessage}</div>
      ) : null}
      <div className="mdbc-search">
        <textarea
          className="mdbc-search-input mdbc-agent-textarea"
          placeholder={AGENT_INPUT_PLACEHOLDER}
          value={value}
          disabled={unavailable}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>
    </div>
  );
}

export { InputBar };
