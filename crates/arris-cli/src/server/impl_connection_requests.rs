use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use arris_engines::{ConnectionPrefill, DatabaseKind};
use tokio::sync::watch;
use uuid::Uuid;

use super::{ApiError, CONNECTION_REQUESTS_MAX, ConnectionRequest, ConnectionRequestStatus};

type Entry = Arc<watch::Sender<ConnectionRequest>>;

/// In-memory browser connection requests; a server restart drops them.
#[derive(Default)]
pub struct ConnectionRequests {
    // Each sender holds its request's current state; waiters subscribe to it.
    entries: Mutex<HashMap<String, Entry>>,
}

impl ConnectionRequests {
    /// The prefill is re-scrubbed here so no caller can park a secret in the form.
    pub fn create(
        &self,
        project: PathBuf,
        kind: Option<DatabaseKind>,
        prefill: Option<ConnectionPrefill>,
    ) -> ConnectionRequest {
        let prefill = prefill.map(ConnectionPrefill::scrubbed);
        let request = ConnectionRequest {
            id: Uuid::new_v4().to_string(),
            project,
            kind: kind.or(prefill.as_ref().map(|p| p.kind)),
            prefill,
            status: ConnectionRequestStatus::Pending,
        };
        let mut entries = self.lock();
        if entries.len() >= CONNECTION_REQUESTS_MAX {
            entries.retain(|_, tx| tx.borrow().status == ConnectionRequestStatus::Pending);
        }
        // shortcut: evicts an arbitrary pending request at the cap; track age if that ever bites.
        if entries.len() >= CONNECTION_REQUESTS_MAX
            && let Some(key) = entries.keys().next().cloned()
        {
            entries.remove(&key);
        }
        let entry = Arc::new(watch::Sender::new(request.clone()));
        entries.insert(request.id.clone(), entry);
        request
    }

    pub fn get(&self, id: &str, project: &Path) -> Result<ConnectionRequest, ApiError> {
        Ok(self.entry(id, project)?.borrow().clone())
    }

    /// First resolution wins; `true` only when this call changed the status.
    pub fn resolve(
        &self,
        id: &str,
        project: &Path,
        status: ConnectionRequestStatus,
    ) -> Result<bool, ApiError> {
        let entry = self.entry(id, project)?;
        Ok(entry.send_if_modified(|request| {
            let pending = request.status == ConnectionRequestStatus::Pending;
            if pending {
                request.status = status;
            }
            pending
        }))
    }

    /// `Pending` on timeout; a terminal status drops the request once handed out.
    pub async fn wait(
        &self,
        id: &str,
        project: &Path,
        timeout: Duration,
    ) -> Result<ConnectionRequestStatus, ApiError> {
        let mut rx = self.entry(id, project)?.subscribe();
        let terminal = rx.wait_for(|r| r.status != ConnectionRequestStatus::Pending);
        let status = match tokio::time::timeout(timeout, terminal).await {
            Ok(Ok(request)) => request.status.clone(),
            // Sender gone means the request was evicted while we waited.
            Ok(Err(_)) => return Err(ApiError::ConnectionRequestNotFound(id.to_owned())),
            Err(_) => ConnectionRequestStatus::Pending,
        };
        if status != ConnectionRequestStatus::Pending {
            self.lock().remove(id);
        }
        Ok(status)
    }

    fn entry(&self, id: &str, project: &Path) -> Result<Entry, ApiError> {
        let entry = self
            .lock()
            .get(id)
            .cloned()
            .ok_or_else(|| ApiError::ConnectionRequestNotFound(id.to_owned()))?;
        if entry.borrow().project != project {
            return Err(ApiError::Forbidden);
        }
        Ok(entry)
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, Entry>> {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHORT_WAIT: Duration = Duration::from_millis(50);
    const PROJECT: &str = "/p";

    fn saved() -> ConnectionRequestStatus {
        ConnectionRequestStatus::Saved {
            connection_id: Uuid::nil(),
            name: "n".into(),
        }
    }

    #[tokio::test]
    async fn wait_returns_pending_on_timeout() {
        let requests = ConnectionRequests::default();
        let project = Path::new(PROJECT);
        let req = requests.create(project.into(), Some(DatabaseKind::Sqlite), None);
        let status = requests.wait(&req.id, project, SHORT_WAIT).await.unwrap();
        assert_eq!(status, ConnectionRequestStatus::Pending);
        assert_eq!(requests.get(&req.id, project).unwrap().id, req.id);
    }

    #[tokio::test]
    async fn first_resolution_wins_and_wait_drops_it() {
        let requests = ConnectionRequests::default();
        let project = Path::new(PROJECT);
        let req = requests.create(project.into(), None, None);
        assert!(requests.resolve(&req.id, project, saved()).unwrap());
        let after = requests.resolve(&req.id, project, ConnectionRequestStatus::Cancelled);
        assert!(!after.unwrap());
        assert_eq!(requests.get(&req.id, project).unwrap().status, saved());
        assert_eq!(
            requests.wait(&req.id, project, SHORT_WAIT).await.unwrap(),
            saved()
        );
        assert!(matches!(
            requests.get(&req.id, project),
            Err(ApiError::ConnectionRequestNotFound(_))
        ));
    }

    #[test]
    fn create_caps_map_preferring_resolved_evictions() {
        let requests = ConnectionRequests::default();
        let project = Path::new(PROJECT);
        let first = requests.create(project.into(), None, None);
        requests.resolve(&first.id, project, saved()).unwrap();
        let rest: Vec<_> = (1..CONNECTION_REQUESTS_MAX)
            .map(|_| requests.create(project.into(), None, None))
            .collect();
        let last = requests.create(project.into(), None, None);
        assert_eq!(requests.lock().len(), CONNECTION_REQUESTS_MAX);
        assert!(requests.get(&first.id, project).is_err());
        assert!(rest.iter().all(|r| requests.get(&r.id, project).is_ok()));
        assert!(requests.get(&last.id, project).is_ok());
        requests.create(project.into(), None, None);
        assert_eq!(requests.lock().len(), CONNECTION_REQUESTS_MAX);
    }
}
