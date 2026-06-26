use serde::{Deserialize, Serialize};

// ── agent provider ───────────────────────────────────────────────────────────

/// Which local CLI backs an agent turn. Chosen in the panel (a header dropdown)
/// and sent with every request; defaults to Codex.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentProvider {
    #[default]
    Codex,
    Claude,
}

impl AgentProvider {
    /// Display label used in errors and the panel header ("Codex", "Claude").
    pub fn label(self) -> &'static str {
        match self {
            AgentProvider::Codex => "Codex",
            AgentProvider::Claude => "Claude",
        }
    }
}

impl std::fmt::Display for AgentProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.label())
    }
}

// ── streamed agent events (forwarded to the frontend) ────────────────────────

/// A single event parsed from a provider's streamed output, forwarded to the
/// panel. Both Codex and Claude map their native event streams onto this set.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentEvent {
    /// Provider session id (used to resume next turn) plus the resolved model the
    /// provider actually picked for the turn, when it reports one. This is the
    /// authoritative model name — it resolves a configured `"default"` to the
    /// concrete model the CLI chose.
    SessionStarted {
        session_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
    },
    /// Assistant message text.
    Message { text: String },
    /// The agent invoked a tool (built-in command).
    ToolCall { tool: String, summary: String },
    /// Turn finished.
    Done,
    /// An error surfaced by the provider.
    Error { message: String },
}
