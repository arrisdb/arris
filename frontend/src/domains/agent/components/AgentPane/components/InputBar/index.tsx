import { ChatInput } from "@shared/ui";
import { useAgentStore } from "../../../../hooks/store";
import { AGENT_INPUT_PLACEHOLDER, PROVIDERS } from "../../constants";

function InputBar({
  available,
  onSend,
}: {
  available: boolean | null;
  onSend: (text: string) => void;
}) {
  const provider = useAgentStore((state) => state.provider);
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
          <div className="mdbc-agent-unavailable">⚠ {PROVIDERS[provider].unavailableMessage}</div>
        ) : null
      }
    />
  );
}

export { InputBar };
