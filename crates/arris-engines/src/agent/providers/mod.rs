//! Per-CLI behavior behind the agentic pane. Each provider (Codex, Claude) is a
//! zero-sized struct implementing [`CliProvider`]: how to detect it, how to
//! configure one turn's spawn command, how to read its model, and how to turn
//! one line of its streamed output into an [`AgentEvent`]. The session runner is
//! provider-agnostic and drives whichever [`CliProvider`] the request selected.

mod claude;
mod codex;

use tokio::process::Command;

use super::impl_cli_resolver::CliResolver;
use super::types::{AgentEvent, AgentProvider};
use claude::ClaudeProvider;
use codex::CodexProvider;

/// One agent CLI reduced to the operations the session runner needs.
pub(super) trait CliProvider: Send + Sync {
    /// Executable looked up on PATH (`codex`, `claude`).
    fn binary(&self) -> &'static str;

    /// Configure the spawn command for one turn: subcommand, flags, the prompt,
    /// and (when resuming) the prior session id. The caller wires the working
    /// directory and stdio; this only appends arguments.
    fn configure(&self, cmd: &mut Command, prompt: &str, resume_session: Option<&str>);

    /// Parse one line of the CLI's streamed output into an event, or `None` for
    /// lines we don't surface. Tolerant by design.
    fn parse_line(&self, line: &str) -> Option<AgentEvent>;

    /// The model the CLI will use, for display. Reads the CLI's own config.
    fn active_model(&self) -> String;

    /// Translate a raw failure tail into a clear, actionable message. Returns the
    /// input unchanged when nothing matches.
    fn friendly_error(&self, raw: &str) -> String;
}

impl AgentProvider {
    /// The CLI implementation backing this provider.
    pub(super) fn cli(self) -> Box<dyn CliProvider> {
        match self {
            AgentProvider::Codex => Box::new(CodexProvider),
            AgentProvider::Claude => Box::new(ClaudeProvider),
        }
    }

    /// Whether this provider's CLI is installed (`<binary> --version` exits 0),
    /// resolved over the user's real PATH so a GUI launch's minimal PATH does not
    /// report an installed CLI as missing.
    pub async fn check(self) -> bool {
        let Some(program) = CliResolver::resolve(self.cli().binary()) else {
            return false;
        };
        Command::new(program)
            .arg("--version")
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// The model this provider's CLI will use, for display in the panel.
    pub fn active_model(self) -> String {
        self.cli().active_model()
    }
}
