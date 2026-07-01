import { useEffect, useMemo } from "react";

import { Select, type SelectOption } from "@shared/ui";
import { Tooltip } from "@shared/ui/Tooltip";

import { useAgentStore } from "../../hooks/store";
import { PROVIDERS, PROVIDER_ORDER } from "../AgentPane/constants";
import type { AgentProvider } from "../AgentPane/types";

/// The Codex/Claude picker plus its subscription hint and resolved model. Wired
/// to the shared agent store, so the choice is one global preference shared by
/// the SQL agent pane and the canvas agent chat. Drop it into any chat header.
function AgentProviderSelect() {
  const provider = useAgentStore((state) => state.provider);
  const model = useAgentStore((state) => state.model);
  const info = PROVIDERS[provider];
  const options = useMemo<SelectOption[]>(
    () => PROVIDER_ORDER.map((p) => ({ value: p, label: PROVIDERS[p].label })),
    [],
  );

  // Resolve the active provider's CLI availability + model for the header.
  useEffect(() => {
    useAgentStore.getState().checkAgent();
  }, []);

  return (
    <>
      <Select
        value={provider}
        options={options}
        onChange={(value) =>
          useAgentStore.getState().setProvider(value as AgentProvider)
        }
        maxWidth={120}
        title="Agent provider"
        data-testid="agent-provider-select"
      />
      <Tooltip label={info.subscriptionHint}>
        <span className="mdbc-agent-info" aria-label={info.subscriptionHint}>
          ⓘ
        </span>
      </Tooltip>
      {model ? <span className="mdbc-agent-model">{model}</span> : null}
    </>
  );
}

export { AgentProviderSelect };
