use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use arris_engines::AppEnvironment;
use tokio::sync::broadcast;

use super::{ConnectionRequests, QueryHandoffs, ServerEvent, UiContext, UiPages};

pub struct ServerState {
    pub env: Arc<AppEnvironment>,
    pub token: String,
    pub port: u16,
    pub events: broadcast::Sender<ServerEvent>,
    pub connection_requests: ConnectionRequests,
    pub query_handoffs: QueryHandoffs,
    /// Latest UI context per project root, kept in memory only.
    pub ui_contexts: Mutex<HashMap<PathBuf, UiContext>>,
    /// Open UI pages, so the CLI opens a browser only when none shows the project.
    pub ui_pages: UiPages,
}

impl ServerState {
    pub fn emit(&self, event: ServerEvent) {
        // No subscribers is a normal state (no UI open), not an error.
        let _ = self.events.send(event);
    }
}
