use std::net::{IpAddr, Ipv4Addr};
use std::path::Path;
use std::time::Duration;

use jupyter_protocol::{
    Channel, CompleteRequest, ConnectionInfo, ExecuteRequest, JupyterMessage,
    JupyterMessageContent, ShutdownRequest, Transport,
};
use jupyter_zmq_client::{
    create_client_control_connection, create_client_iopub_connection,
    create_client_shell_connection_with_identity, peek_ports_with_listeners,
    peer_identity_for_session, wait_for_iopub_welcome, ClientControlConnection,
    ClientIoPubConnection, ClientShellConnection,
};
use tempfile::TempPath;
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use uuid::Uuid;

use super::errors::PythonError;
use super::types::{Completion, KernelOutput};

/// A running IPython kernel bound to one console, plus the channels used to
/// drive it. Output flows out of the iopub reader task into an mpsc channel
/// the caller drains; the session itself is send-only on shell and control.
pub(super) struct KernelSession {
    child: Mutex<Child>,
    shell: Mutex<ClientShellConnection>,
    control: Mutex<ClientControlConnection>,
    pid: u32,
    // `Option` so `shutdown` can take the handle and await its termination,
    // guaranteeing the iopub SUB socket is dropped before a replacement kernel
    // is launched on recycled ports.
    reader: Mutex<Option<JoinHandle<()>>>,
    // Held for the session lifetime so the connection file is deleted on drop.
    _conn_file: TempPath,
}

impl KernelSession {
    /// Launch `python -m ipykernel_launcher`, connect the ZMQ channels, and
    /// return the session together with a receiver of streamed kernel output.
    pub(super) async fn start(
        python: &Path,
    ) -> Result<(KernelSession, mpsc::UnboundedReceiver<KernelOutput>), PythonError> {
        let ip = IpAddr::V4(Ipv4Addr::LOCALHOST);
        let session_id = Uuid::new_v4().to_string();

        // Reserve five ports, keeping the listeners until just before launch.
        let (ports, listeners) = peek_ports_with_listeners(ip, 5)
            .await
            .map_err(|e| PythonError::Kernel(e.to_string()))?;
        let info = ConnectionInfo {
            transport: Transport::TCP,
            ip: ip.to_string(),
            shell_port: ports[0],
            iopub_port: ports[1],
            stdin_port: ports[2],
            control_port: ports[3],
            hb_port: ports[4],
            signature_scheme: "hmac-sha256".to_string(),
            key: Uuid::new_v4().to_string(),
            kernel_name: Some("python3".to_string()),
        };

        let conn_file = tempfile::Builder::new().suffix(".json").tempfile()?;
        let bytes =
            serde_json::to_vec(&info).map_err(|e| PythonError::Kernel(e.to_string()))?;
        std::fs::write(conn_file.path(), bytes)?;
        let conn_path = conn_file.into_temp_path();

        // Release the reserved ports immediately before spawning the kernel.
        drop(listeners);
        let child = Command::new(python)
            .args(["-m", "ipykernel_launcher", "-f"])
            .arg(&conn_path)
            .spawn()?;
        let pid = child
            .id()
            .ok_or_else(|| PythonError::Kernel("kernel process has no pid".to_string()))?;

        let peer = peer_identity_for_session(&session_id)
            .map_err(|e| PythonError::Kernel(e.to_string()))?;
        let mut iopub = create_client_iopub_connection(&info, "", &session_id)
            .await
            .map_err(|e| PythonError::Kernel(e.to_string()))?;
        let shell = create_client_shell_connection_with_identity(&info, &session_id, peer)
            .await
            .map_err(|e| PythonError::Kernel(e.to_string()))?;
        let control = create_client_control_connection(&info, &session_id)
            .await
            .map_err(|e| PythonError::Kernel(e.to_string()))?;
        // Best-effort: wait for the kernel to announce it is listening on iopub.
        let _ = wait_for_iopub_welcome(&mut iopub, Duration::from_secs(10)).await;

        let (tx, rx) = mpsc::unbounded_channel();
        let reader = tokio::spawn(Self::reader_loop(iopub, tx));

        let session = KernelSession {
            child: Mutex::new(child),
            shell: Mutex::new(shell),
            control: Mutex::new(control),
            pid,
            reader: Mutex::new(Some(reader)),
            _conn_file: conn_path,
        };
        Ok((session, rx))
    }

    /// Send code to the kernel; returns the `execute_request` id so callers can
    /// correlate the streamed output that arrives under that parent.
    pub(super) async fn execute(&self, code: String) -> Result<String, PythonError> {
        let request = ExecuteRequest {
            code,
            silent: false,
            store_history: true,
            user_expressions: None,
            allow_stdin: false,
            stop_on_error: true,
        };
        let mut msg = JupyterMessage::new(JupyterMessageContent::ExecuteRequest(request), None);
        msg.channel = Some(Channel::Shell);
        let id = msg.header.msg_id.clone();
        self.shell
            .lock()
            .await
            .send(msg)
            .await
            .map_err(|e| PythonError::Kernel(e.to_string()))?;
        Ok(id)
    }

    /// Request completions at `cursor_pos` within `code`. Sends a
    /// `complete_request` on the shell channel and reads replies until the
    /// matching `complete_reply` arrives, skipping any unrelated shell traffic
    /// (e.g. a buffered `execute_reply`).
    pub(super) async fn complete(
        &self,
        code: String,
        cursor_pos: usize,
    ) -> Result<Completion, PythonError> {
        let request = CompleteRequest { code, cursor_pos };
        let mut msg = JupyterMessage::new(JupyterMessageContent::CompleteRequest(request), None);
        msg.channel = Some(Channel::Shell);
        let req_id = msg.header.msg_id.clone();

        let mut shell = self.shell.lock().await;
        shell
            .send(msg)
            .await
            .map_err(|e| PythonError::Kernel(e.to_string()))?;
        loop {
            let reply = shell
                .read()
                .await
                .map_err(|e| PythonError::Kernel(e.to_string()))?;
            let belongs = reply
                .parent_header
                .as_ref()
                .map(|h| h.msg_id == req_id)
                .unwrap_or(false);
            if let JupyterMessageContent::CompleteReply(c) = reply.content {
                if belongs {
                    return Ok(Completion {
                        matches: c.matches,
                        cursor_start: c.cursor_start,
                        cursor_end: c.cursor_end,
                    });
                }
            }
        }
    }

    /// Interrupt the running cell by signalling the kernel process (ipykernel's
    /// default interrupt mode is signal-based, not control-channel).
    #[cfg(unix)]
    pub(super) fn interrupt(&self) -> Result<(), PythonError> {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        kill(Pid::from_raw(self.pid as i32), Signal::SIGINT)
            .map_err(|e| PythonError::Kernel(e.to_string()))
    }

    #[cfg(not(unix))]
    pub(super) fn interrupt(&self) -> Result<(), PythonError> {
        Err(PythonError::Kernel(
            "interrupt is not supported on this platform".to_string(),
        ))
    }

    /// Ask the kernel to shut down, then stop the reader and kill the process.
    pub(super) async fn shutdown(&self) {
        let mut msg = JupyterMessage::new(
            JupyterMessageContent::ShutdownRequest(ShutdownRequest { restart: false }),
            None,
        );
        msg.channel = Some(Channel::Control);
        let _ = self.control.lock().await.send(msg).await;
        // Abort the reader AND wait for it to finish so its iopub SUB socket is
        // closed before any replacement kernel binds the (recycled) ports — a
        // lingering subscriber would otherwise receive the new kernel's output
        // too, duplicating cell results.
        if let Some(reader) = self.reader.lock().await.take() {
            reader.abort();
            let _ = reader.await;
        }
        let _ = self.child.lock().await.kill().await;
    }

    /// Drain iopub messages, forwarding rendered output until the channel or the
    /// receiver closes.
    async fn reader_loop(
        mut iopub: ClientIoPubConnection,
        tx: mpsc::UnboundedSender<KernelOutput>,
    ) {
        loop {
            match iopub.read().await {
                Ok(msg) => {
                    if let Some(output) = KernelOutput::from_message(&msg) {
                        if tx.send(output).is_err() {
                            break;
                        }
                    }
                }
                Err(_) => break,
            }
        }
    }
}

impl Drop for KernelSession {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.reader.try_lock() {
            if let Some(reader) = guard.take() {
                reader.abort();
            }
        }
        if let Ok(mut child) = self.child.try_lock() {
            let _ = child.start_kill();
        }
    }
}
