import { ChatInput } from "@shared/ui";
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
  // A null status means the check hasn't resolved yet, so don't block on unknowns.
  // Auth is NOT pre-checked: if the CLI is signed out, the turn runs and its error
  // (e.g. "not logged in") streams back into the message list.
  const unavailable = available === false;
  return (
    <ChatInput
      placeholder={AGENT_INPUT_PLACEHOLDER}
      disabled={unavailable}
      onSend={onSend}
      banner={
        unavailable ? (
          <div className="mdbc-agent-unavailable">⚠ {unavailableMessage}</div>
        ) : null
      }
    />
  );
}

export { InputBar };
