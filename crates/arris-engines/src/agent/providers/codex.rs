//! Codex provider: spawns `codex exec --json` in a read-only sandbox and parses
//! its ndjson event stream.

use std::path::PathBuf;

use tokio::process::Command;

use super::CliProvider;
use crate::agent::types::AgentEvent;

pub(super) struct CodexProvider;

impl CodexProvider {
    /// Path to codex's config, `$CODEX_HOME/config.toml` (default
    /// `~/.codex/config.toml`).
    fn config_path() -> Option<PathBuf> {
        if let Some(home) = std::env::var_os("CODEX_HOME") {
            return Some(PathBuf::from(home).join("config.toml"));
        }
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".codex").join("config.toml"))
    }
}

impl CliProvider for CodexProvider {
    fn binary(&self) -> &'static str {
        "codex"
    }

    fn configure(&self, cmd: &mut Command, prompt: &str, resume_session: Option<&str>) {
        cmd.arg("exec");
        if let Some(session) = resume_session {
            cmd.arg("resume").arg(session);
        }
        cmd.arg("--json")
            .arg("--skip-git-repo-check")
            // Disable AGENTS.md (project + global) so the user's repo/global docs
            // can't derail a query-writing turn. read-only sandbox keeps the
            // agent off the filesystem; never auto-proceeds without a TTY prompt.
            .arg("-c")
            .arg("project_doc_max_bytes=0")
            .arg("-c")
            .arg("sandbox_mode=\"read-only\"")
            .arg("-c")
            .arg("approval_policy=\"never\"")
            .arg(prompt);
    }

    /// Parse a single line of `codex exec --json` output. Returns `None` for
    /// lines we don't surface (e.g. `turn.started`, usage). Tolerant by design.
    fn parse_line(&self, line: &str) -> Option<AgentEvent> {
        let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
        let ty = value.get("type")?.as_str()?;
        match ty {
            "thread.started" => {
                let session_id = value.get("thread_id")?.as_str()?.to_string();
                // Surface the resolved model when codex reports one, so the panel
                // can show the concrete model rather than a configured `"default"`.
                let model = value
                    .get("model")
                    .and_then(|m| m.as_str())
                    .map(str::to_string);
                Some(AgentEvent::SessionStarted { session_id, model })
            }
            "turn.completed" => Some(AgentEvent::Done),
            "turn.failed" | "error" => Some(AgentEvent::Error {
                message: self.friendly_error(
                    value
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .or_else(|| value.get("message"))
                        .and_then(|m| m.as_str())
                        .unwrap_or("codex error"),
                ),
            }),
            "item.started" | "item.completed" => {
                let item = value.get("item")?;
                let item_ty = item.get("type")?.as_str()?;
                match item_ty {
                    "agent_message" if ty == "item.completed" => {
                        let text = item.get("text")?.as_str()?.to_string();
                        Some(AgentEvent::Message { text })
                    }
                    other if other.contains("tool") || other.contains("command") => {
                        if ty != "item.started" {
                            return None;
                        }
                        let tool = item
                            .get("tool")
                            .or_else(|| item.get("name"))
                            .or_else(|| item.get("command"))
                            .and_then(|t| t.as_str())
                            .unwrap_or(other)
                            .to_string();
                        Some(AgentEvent::ToolCall {
                            tool,
                            summary: String::new(),
                        })
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// The model codex will use, read from its `config.toml`. Returns `"default"`
    /// when no `model` is set.
    fn active_model(&self) -> String {
        let Some(path) = Self::config_path() else {
            return "default".to_string();
        };
        let Ok(text) = std::fs::read_to_string(path) else {
            return "default".to_string();
        };
        for line in text.lines() {
            let line = line.trim();
            if let Some((key, value)) = line.split_once('=') {
                if key.trim() == "model" {
                    return value.trim().trim_matches('"').to_string();
                }
            }
        }
        "default".to_string()
    }

    /// Translate codex's raw failure text into a clear, actionable message. The
    /// common case is an auth failure (401 / missing bearer / not signed in),
    /// where codex's retry spam ("Reconnecting… 2/5 (unexpected status 401…)")
    /// is opaque. Returns the input unchanged when nothing matches.
    fn friendly_error(&self, raw: &str) -> String {
        let low = raw.to_lowercase();
        let auth = low.contains("401")
            || low.contains("unauthorized")
            || low.contains("missing bearer")
            || low.contains("not logged in")
            || low.contains("invalid api key")
            || low.contains("invalid_api_key");
        if auth {
            return "Codex isn't signed in. Run `codex login` in your terminal \
                    (or set OPENAI_API_KEY), then send your message again."
                .to_string();
        }
        raw.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Fixture lines captured from a real `codex exec --json` run.
    const THREAD_STARTED: &str =
        r#"{"type":"thread.started","thread_id":"019eaff6-2e79-7742-9a84-05e4db5938c0","model":"gpt-5-codex"}"#;
    const TURN_STARTED: &str = r#"{"type":"turn.started"}"#;
    const AGENT_MESSAGE: &str =
        r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hello"}}"#;
    const TURN_COMPLETED: &str = r#"{"type":"turn.completed","usage":{"input_tokens":25421}}"#;

    #[test]
    fn parses_session_id_and_model_from_thread_started() {
        assert_eq!(
            CodexProvider.parse_line(THREAD_STARTED),
            Some(AgentEvent::SessionStarted {
                session_id: "019eaff6-2e79-7742-9a84-05e4db5938c0".to_string(),
                model: Some("gpt-5-codex".to_string()),
            })
        );
    }

    #[test]
    fn thread_started_without_model_yields_none() {
        let line = r#"{"type":"thread.started","thread_id":"t-1"}"#;
        assert_eq!(
            CodexProvider.parse_line(line),
            Some(AgentEvent::SessionStarted {
                session_id: "t-1".to_string(),
                model: None,
            })
        );
    }

    #[test]
    fn parses_agent_message() {
        assert_eq!(
            CodexProvider.parse_line(AGENT_MESSAGE),
            Some(AgentEvent::Message {
                text: "hello".to_string()
            })
        );
    }

    #[test]
    fn parses_turn_completed_as_done() {
        assert_eq!(CodexProvider.parse_line(TURN_COMPLETED), Some(AgentEvent::Done));
    }

    #[test]
    fn parses_tool_call() {
        let line = r#"{"type":"item.started","item":{"type":"command_execution","command":"ls"}}"#;
        assert_eq!(
            CodexProvider.parse_line(line),
            Some(AgentEvent::ToolCall {
                tool: "ls".to_string(),
                summary: String::new(),
            })
        );
    }

    #[test]
    fn ignores_uninteresting_and_invalid_lines() {
        assert_eq!(CodexProvider.parse_line(TURN_STARTED), None);
        assert_eq!(CodexProvider.parse_line("not json"), None);
        assert_eq!(CodexProvider.parse_line(""), None);
    }

    #[test]
    fn friendly_error_maps_auth_failures_to_login_hint() {
        let raw = "Reconnecting... 2/5 (unexpected status 401 Unauthorized: \
                   Missing bearer or basic authentication in header, \
                   url: wss://api.openai.com/v1/responses, cf-ray: abc-YVR)";
        let msg = CodexProvider.friendly_error(raw);
        assert!(msg.contains("codex login"));
        assert!(msg.contains("OPENAI_API_KEY"));
        assert!(!msg.contains("401"));
    }

    #[test]
    fn friendly_error_passes_through_non_auth_text() {
        let raw = "syntax error near \"SELCT\"";
        assert_eq!(CodexProvider.friendly_error(raw), raw);
    }

    #[test]
    fn configure_includes_read_only_flags_and_prompt() {
        let mut cmd = Command::new("codex");
        CodexProvider.configure(&mut cmd, "hi", None);
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args.first().map(String::as_str), Some("exec"));
        assert!(args.iter().any(|a| a == "--json"));
        assert!(args.iter().any(|a| a == "sandbox_mode=\"read-only\""));
        assert_eq!(args.last().map(String::as_str), Some("hi"));
        assert!(!args.iter().any(|a| a == "resume"));
    }

    #[test]
    fn configure_resumes_with_session_id() {
        let mut cmd = Command::new("codex");
        CodexProvider.configure(&mut cmd, "hi", Some("sess-1"));
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let pos = args.iter().position(|a| a == "resume").expect("resume arg");
        assert_eq!(args.get(pos + 1).map(String::as_str), Some("sess-1"));
    }
}
