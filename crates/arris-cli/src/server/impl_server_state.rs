use std::sync::Arc;

use arris_engines::AppEnvironment;
use tokio::sync::broadcast;

use super::{ConnectionRequests, ServerEvent};

pub struct ServerState {
    pub env: Arc<AppEnvironment>,
    pub token: String,
    pub port: u16,
    pub events: broadcast::Sender<ServerEvent>,
    pub connection_requests: ConnectionRequests,
}

impl ServerState {
    pub fn emit(&self, event: ServerEvent) {
        // No subscribers is a normal state (no UI open), not an error.
        let _ = self.events.send(event);
    }
}
