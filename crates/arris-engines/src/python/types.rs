use std::path::PathBuf;

use jupyter_protocol::{ExecutionState, JupyterMessage, JupyterMessageContent, Stdio};
use serde::{Deserialize, Serialize};

/// A discovered or created Python interpreter the console can bind to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PythonInterpreter {
    pub path: PathBuf,
    pub version: String,
    pub source: InterpreterSource,
}

/// Where a discovered interpreter came from.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InterpreterSource {
    /// Found on the `PATH`.
    Path,
    /// Found under a `pyenv` versions directory.
    Pyenv,
    /// Found in a well-known install directory.
    Common,
    /// A virtualenv the app created or was pointed at.
    Venv,
}

/// Result of creating a venv and ensuring the kernel dependency is present.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedVenv {
    pub interpreter: PythonInterpreter,
    pub ipykernel_ready: bool,
}

/// Completion candidates for a cursor position, as returned by the kernel's
/// `complete_reply`. `cursor_start`/`cursor_end` bound the text each match
/// replaces, so the editor can splice candidates in correctly.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Completion {
    pub matches: Vec<String>,
    pub cursor_start: usize,
    pub cursor_end: usize,
}

/// A normalized kernel output event streamed to the frontend. `parent` carries
/// the originating `execute_request` id so the UI can attribute output to a cell.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum KernelOutput {
    Stream {
        parent: Option<String>,
        name: String,
        text: String,
    },
    Result {
        parent: Option<String>,
        data: serde_json::Value,
    },
    Display {
        parent: Option<String>,
        data: serde_json::Value,
    },
    Error {
        parent: Option<String>,
        ename: String,
        evalue: String,
        traceback: Vec<String>,
    },
    Status {
        parent: Option<String>,
        state: String,
    },
}

impl KernelOutput {
    /// Map a raw Jupyter message to a console output event, or `None` for
    /// message types the console does not render (e.g. `execute_input`).
    pub(super) fn from_message(msg: &JupyterMessage) -> Option<Self> {
        let parent = msg.parent_header.as_ref().map(|h| h.msg_id.clone());
        match &msg.content {
            JupyterMessageContent::StreamContent(s) => Some(KernelOutput::Stream {
                parent,
                name: match s.name {
                    Stdio::Stdout => "stdout".to_string(),
                    Stdio::Stderr => "stderr".to_string(),
                },
                text: s.text.clone(),
            }),
            JupyterMessageContent::ExecuteResult(r) => Some(KernelOutput::Result {
                parent,
                data: serde_json::to_value(&r.data).ok()?,
            }),
            JupyterMessageContent::DisplayData(d) => Some(KernelOutput::Display {
                parent,
                data: serde_json::to_value(&d.data).ok()?,
            }),
            JupyterMessageContent::ErrorOutput(e) => Some(KernelOutput::Error {
                parent,
                ename: e.ename.clone(),
                evalue: e.evalue.clone(),
                traceback: e.traceback.clone(),
            }),
            JupyterMessageContent::Status(s) => Some(KernelOutput::Status {
                parent,
                state: Self::state_label(&s.execution_state),
            }),
            _ => None,
        }
    }

    fn state_label(state: &ExecutionState) -> String {
        match state {
            ExecutionState::Starting => "starting",
            ExecutionState::Busy => "busy",
            ExecutionState::Idle => "idle",
            ExecutionState::Restarting => "restarting",
            ExecutionState::Terminating => "terminating",
            ExecutionState::AutoRestarting => "restarting",
            ExecutionState::Dead => "dead",
            ExecutionState::Unknown => "unknown",
            ExecutionState::Other(s) => return s.clone(),
        }
        .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jupyter_protocol::{ExecutionState, Status, StreamContent};

    #[test]
    fn maps_stream_to_stdout_text() {
        let msg = JupyterMessage::new(
            JupyterMessageContent::StreamContent(StreamContent {
                name: Stdio::Stdout,
                text: "hello\n".to_string(),
            }),
            None,
        );
        match KernelOutput::from_message(&msg) {
            Some(KernelOutput::Stream { name, text, parent }) => {
                assert_eq!(name, "stdout");
                assert_eq!(text, "hello\n");
                assert!(parent.is_none());
            }
            other => panic!("expected stream, got {other:?}"),
        }
    }

    #[test]
    fn maps_status_idle() {
        let msg = JupyterMessage::new(
            JupyterMessageContent::Status(Status {
                execution_state: ExecutionState::Idle,
            }),
            None,
        );
        match KernelOutput::from_message(&msg) {
            Some(KernelOutput::Status { state, parent }) => {
                assert_eq!(state, "idle");
                assert!(parent.is_none());
            }
            other => panic!("expected status, got {other:?}"),
        }
    }

    #[test]
    fn completion_serializes_camel_case() {
        let c = Completion {
            matches: vec!["os.path".to_string()],
            cursor_start: 3,
            cursor_end: 6,
        };
        let json = serde_json::to_value(&c).unwrap();
        assert_eq!(json["matches"][0], "os.path");
        assert_eq!(json["cursorStart"], 3);
        assert_eq!(json["cursorEnd"], 6);
    }

    #[test]
    fn ignores_unrendered_messages() {
        let msg = JupyterMessage::new(
            JupyterMessageContent::ExecuteInput(jupyter_protocol::ExecuteInput {
                code: "1+1".to_string(),
                execution_count: jupyter_protocol::ExecutionCount::new(1),
            }),
            None,
        );
        assert!(KernelOutput::from_message(&msg).is_none());
    }
}
