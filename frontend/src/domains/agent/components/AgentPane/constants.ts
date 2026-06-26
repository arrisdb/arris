import type { AgentProvider } from "./types";

interface ProviderInfo {
  label: string;
  unavailableMessage: string;
  subscriptionHint: string;
}

const AGENT_PANE_TITLE = "AGENT";
const AGENT_INPUT_PLACEHOLDER = "Ask the agent… (⌘↵ to send)";

// Per-provider display copy. Selecting a provider swaps the header label, the
// availability warning, and the ⓘ subscription hint.
const PROVIDERS: Record<AgentProvider, ProviderInfo> = {
  codex: {
    label: "Codex",
    unavailableMessage: "Codex CLI not found on PATH. Install it to use the agent.",
    subscriptionHint:
      "The agent runs your local Codex CLI. It needs an active Codex (ChatGPT) subscription or an OPENAI_API_KEY.",
  },
  claude: {
    label: "Claude",
    unavailableMessage: "Claude CLI not found on PATH. Install it to use the agent.",
    subscriptionHint:
      "The agent runs your local Claude CLI (claude -p). It needs an active Claude subscription or an ANTHROPIC_API_KEY.",
  },
};

// Order the provider dropdown lists its options in.
const PROVIDER_ORDER: AgentProvider[] = ["codex", "claude"];

const SHARE_ALL_ROWS_WARNING =
  "All rows can be slow on large tables and consumes far more agent tokens.";
const SHARE_NO_CONNECTION_HINT = "Select a connection to run & share:";

export {
  AGENT_PANE_TITLE,
  AGENT_INPUT_PLACEHOLDER,
  PROVIDERS,
  PROVIDER_ORDER,
  SHARE_ALL_ROWS_WARNING,
  SHARE_NO_CONNECTION_HINT,
};
export type { ProviderInfo };
