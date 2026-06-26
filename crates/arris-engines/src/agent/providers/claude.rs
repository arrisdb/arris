//! Claude provider: spawns `claude -p` in print mode with streamed JSON output
//! and parses its event stream. Filesystem/shell tools are disallowed so the
//! turn stays a pure SQL writer, mirroring codex's read-only sandbox.

use std::path::PathBuf;

use tokio::process::Command;

use super::CliProvider;
use crate::agent::types::AgentEvent;

pub(super) struct ClaudeProvider;

impl ClaudeProvider {
    /// Path to claude's user settings, `~/.claude/settings.json`.
    fn settings_path() -> Option<PathBuf> {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".claude").join("settings.json"))
    }
}

impl CliProvider for ClaudeProvider {
    fn binary(&self) -> &'static str {
        "claude"
    }

    fn configure(&self, cmd: &mut Command, prompt: &str, resume_session: Option<&str>) {
        // Print mode with the streamed-JSON event protocol (`--verbose` makes it
        // emit one event per line rather than a single final blob).
        cmd.arg("-p")
            .arg(prompt)
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose");
        let model = self.active_model();
        if model != "default" {
            cmd.arg("--model").arg(model);
        }
        if let Some(session) = resume_session {
            cmd.arg("--resume").arg(session);
        }
        // Keep the turn a pure SQL writer: no shell, no file edits.
        cmd.arg("--disallowedTools").arg("Bash Edit Write");
    }

    /// Parse a single line of `claude -p --output-format stream-json` output.
    /// Returns `None` for lines we don't surface. Tolerant by design.
    fn parse_line(&self, line: &str) -> Option<AgentEvent> {
        let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
        match value.get("type")?.as_str()? {
            // The init system event carries the session id used to resume.
            "system" => {
                if value.get("subtype").and_then(|s| s.as_str()) != Some("init") {
                    return None;
                }
                let session_id = value.get("session_id")?.as_str()?.to_string();
                // The init event reports the resolved model (e.g. `claude-opus-4-8`),
                // even when settings configure `"default"`.
                let model = value
                    .get("model")
                    .and_then(|m| m.as_str())
                    .map(str::to_string);
                Some(AgentEvent::SessionStarted { session_id, model })
            }
            // An assistant turn: one message whose content is a list of blocks.
            // A SQL turn yields a single text block; surface the first text block,
            // else the first tool_use as a tool call.
            "assistant" => {
                let blocks = value.get("message")?.get("content")?.as_array()?;
                for block in blocks {
                    match block.get("type").and_then(|t| t.as_str()) {
                        Some("text") => {
                            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                                if !text.is_empty() {
                                    return Some(AgentEvent::Message {
                                        text: text.to_string(),
                                    });
                                }
                            }
                        }
                        Some("tool_use") => {
                            let tool = block
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("tool")
                                .to_string();
                            return Some(AgentEvent::ToolCall {
                                tool,
                                summary: String::new(),
                            });
                        }
                        _ => {}
                    }
                }
                None
            }
            // The terminal result event ends the turn (success) or reports why it
            // failed.
            "result" => {
                let subtype = value.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
                if subtype == "success" {
                    Some(AgentEvent::Done)
                } else {
                    let raw = value
                        .get("result")
                        .or_else(|| value.get("error"))
                        .and_then(|r| r.as_str())
                        .unwrap_or("claude error");
                    Some(AgentEvent::Error {
                        message: self.friendly_error(raw),
                    })
                }
            }
            _ => None,
        }
    }

    /// The model claude will use, read from `~/.claude/settings.json`. Returns
    /// `"default"` when no `model` is set.
    fn active_model(&self) -> String {
        let Some(path) = Self::settings_path() else {
            return "default".to_string();
        };
        let Ok(text) = std::fs::read_to_string(path) else {
            return "default".to_string();
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
            return "default".to_string();
        };
        value
            .get("model")
            .and_then(|m| m.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "default".to_string())
    }

    /// Translate claude's raw failure text into a clear, actionable message. The
    /// common case is an auth failure. Returns the input unchanged otherwise.
    fn friendly_error(&self, raw: &str) -> String {
        let low = raw.to_lowercase();
        let auth = low.contains("401")
            || low.contains("unauthorized")
            || low.contains("not logged in")
            || low.contains("invalid api key")
            || low.contains("invalid_api_key")
            || low.contains("authentication");
        if auth {
            return "Claude isn't signed in. Run `claude` once to log in \
                    (or set ANTHROPIC_API_KEY), then send your message again."
                .to_string();
        }
        raw.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Fixture lines shaped like `claude -p --output-format stream-json` output.
    const SYSTEM_INIT: &str =
        r#"{"type":"system","subtype":"init","session_id":"abc-123","model":"claude-opus-4-8"}"#;
    const ASSISTANT_TEXT: &str = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"SELECT 1;"}]}}"#;
    const ASSISTANT_TOOL: &str = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{}}]}}"#;
    const RESULT_SUCCESS: &str =
        r#"{"type":"result","subtype":"success","result":"done","session_id":"abc-123"}"#;
    const RESULT_ERROR: &str =
        r#"{"type":"result","subtype":"error_during_execution","result":"boom"}"#;

    #[test]
    fn parses_session_id_and_resolved_model_from_system_init() {
        assert_eq!(
            ClaudeProvider.parse_line(SYSTEM_INIT),
            Some(AgentEvent::SessionStarted {
                session_id: "abc-123".to_string(),
                model: Some("claude-opus-4-8".to_string()),
            })
        );
    }

    #[test]
    fn parses_assistant_text_message() {
        assert_eq!(
            ClaudeProvider.parse_line(ASSISTANT_TEXT),
            Some(AgentEvent::Message {
                text: "SELECT 1;".to_string()
            })
        );
    }

    #[test]
    fn parses_assistant_tool_use() {
        assert_eq!(
            ClaudeProvider.parse_line(ASSISTANT_TOOL),
            Some(AgentEvent::ToolCall {
                tool: "Read".to_string(),
                summary: String::new(),
            })
        );
    }

    #[test]
    fn parses_result_success_as_done() {
        assert_eq!(ClaudeProvider.parse_line(RESULT_SUCCESS), Some(AgentEvent::Done));
    }

    #[test]
    fn parses_result_error_as_error() {
        assert_eq!(
            ClaudeProvider.parse_line(RESULT_ERROR),
            Some(AgentEvent::Error {
                message: "boom".to_string()
            })
        );
    }

    #[test]
    fn ignores_non_init_system_and_invalid_lines() {
        let other_system = r#"{"type":"system","subtype":"other"}"#;
        assert_eq!(ClaudeProvider.parse_line(other_system), None);
        assert_eq!(ClaudeProvider.parse_line("not json"), None);
        assert_eq!(ClaudeProvider.parse_line(""), None);
    }

    #[test]
    fn friendly_error_maps_auth_failures_to_login_hint() {
        let msg = ClaudeProvider.friendly_error("Error: 401 Unauthorized (authentication failed)");
        assert!(msg.contains("claude"));
        assert!(msg.contains("ANTHROPIC_API_KEY"));
        assert!(!msg.contains("401"));
    }

    #[test]
    fn friendly_error_passes_through_non_auth_text() {
        let raw = "syntax error near \"SELCT\"";
        assert_eq!(ClaudeProvider.friendly_error(raw), raw);
    }

    #[test]
    fn configure_uses_print_mode_and_disallows_tools() {
        let mut cmd = Command::new("claude");
        ClaudeProvider.configure(&mut cmd, "write a select", None);
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args.first().map(String::as_str), Some("-p"));
        assert!(args.iter().any(|a| a == "write a select"));
        assert!(args.iter().any(|a| a == "stream-json"));
        assert!(args.iter().any(|a| a == "--verbose"));
        let pos = args
            .iter()
            .position(|a| a == "--disallowedTools")
            .expect("disallowedTools arg");
        assert_eq!(args.get(pos + 1).map(String::as_str), Some("Bash Edit Write"));
        assert!(!args.iter().any(|a| a == "--resume"));
    }

    #[test]
    fn configure_resumes_with_session_id() {
        let mut cmd = Command::new("claude");
        ClaudeProvider.configure(&mut cmd, "hi", Some("sess-9"));
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let pos = args.iter().position(|a| a == "--resume").expect("resume arg");
        assert_eq!(args.get(pos + 1).map(String::as_str), Some("sess-9"));
    }
}
