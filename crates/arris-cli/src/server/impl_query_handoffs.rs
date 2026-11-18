use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::QueryHandoff;

/// Queries waiting for a browser tab, by project. A take is atomic, so one tab opens each.
#[derive(Default)]
pub struct QueryHandoffs {
    pending: Mutex<HashMap<PathBuf, Vec<QueryHandoff>>>,
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

    pub fn is_pending(&self, project: &Path, id: &str) -> bool {
        let pending = self.pending.lock().unwrap();
        pending
            .get(project)
            .is_some_and(|list| list.iter().any(|h| h.id == id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handoff(id: &str) -> QueryHandoff {
        QueryHandoff {
            id: id.into(),
            connection_id: "c1".into(),
            sql: "SELECT 1".into(),
            run_id: None,
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
}
