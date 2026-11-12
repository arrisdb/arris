use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::{BROWSER_LAUNCH_GRACE_SECS, QueryHandoff};

/// Queries and canvases waiting for a browser tab, by project. A take is atomic, so one tab opens each.
#[derive(Default)]
pub struct QueryHandoffs {
    pending: Mutex<HashMap<PathBuf, Vec<QueryHandoff>>>,
    launches: Mutex<HashMap<PathBuf, Instant>>,
}

impl QueryHandoffs {
    pub fn push(&self, project: &Path, handoff: QueryHandoff) {
        let mut pending = self.pending.lock().unwrap();
        pending
            .entry(project.to_path_buf())
            .or_default()
            .push(handoff);
    }

    pub fn take(&self, project: &Path) -> Vec<QueryHandoff> {
        let mut pending = self.pending.lock().unwrap();
        pending.remove(project).unwrap_or_default()
    }

    /// True for the first caller per grace window, so one CLI opens the browser while it loads.
    pub fn claim_launch(&self, project: &Path) -> bool {
        let mut launches = self.launches.lock().unwrap();
        let grace = Duration::from_secs(BROWSER_LAUNCH_GRACE_SECS);
        if launches.get(project).is_some_and(|at| at.elapsed() < grace) {
            return false;
        }
        launches.insert(project.to_path_buf(), Instant::now());
        true
    }

    pub fn is_pending(&self, project: &Path, id: &str) -> bool {
        let pending = self.pending.lock().unwrap();
        pending
            .get(project)
            .is_some_and(|list| list.iter().any(|h| h.id == id))
    }
}

#[cfg(test)]
mod tests {
    use super::super::HandoffTarget;
    use super::*;

    fn handoff(id: &str) -> QueryHandoff {
        QueryHandoff {
            id: id.into(),
            target: HandoffTarget::Canvas {
                canvas_id: "b1".into(),
                title: "B".into(),
            },
        }
    }

    #[test]
    fn take_hands_each_query_to_one_caller_per_project() {
        let handoffs = QueryHandoffs::default();
        let (a, b) = (Path::new("/a"), Path::new("/b"));
        handoffs.push(a, handoff("1"));
        assert!(handoffs.is_pending(a, "1"));
        assert!(handoffs.take(b).is_empty());
        assert_eq!(handoffs.take(a).len(), 1);
        assert!(handoffs.take(a).is_empty());
        assert!(!handoffs.is_pending(a, "1"));
    }

    #[test]
    fn only_the_first_caller_launches_the_browser() {
        let handoffs = QueryHandoffs::default();
        let (a, b) = (Path::new("/a"), Path::new("/b"));
        assert!(handoffs.claim_launch(a));
        assert!(!handoffs.claim_launch(a));
        assert!(handoffs.claim_launch(b));
    }
}
