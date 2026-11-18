use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use super::ServerState;

/// Live UI event streams per project; `None` follows every project (the desktop app).
#[derive(Default)]
pub struct UiPages {
    open: Mutex<HashMap<Option<PathBuf>, usize>>,
}

impl UiPages {
    pub fn is_open(&self, root: &Path) -> bool {
        let open = self.open.lock().unwrap();
        open.contains_key(&None) || open.contains_key(&Some(root.to_path_buf()))
    }

    fn add(&self, key: &Option<PathBuf>) {
        *self.open.lock().unwrap().entry(key.clone()).or_default() += 1;
    }

    fn remove(&self, key: &Option<PathBuf>) {
        let mut open = self.open.lock().unwrap();
        if let Some(count) = open.get_mut(key) {
            *count -= 1;
            if *count == 0 {
                open.remove(key);
            }
        }
    }
}

/// Counts one UI event stream as open for as long as it is held.
pub struct UiPage {
    state: Arc<ServerState>,
    key: Option<PathBuf>,
}

impl UiPage {
    pub fn open(state: Arc<ServerState>, key: Option<PathBuf>) -> Self {
        state.ui_pages.add(&key);
        Self { state, key }
    }
}

impl Drop for UiPage {
    fn drop(&mut self) {
        self.state.ui_pages.remove(&self.key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_counts_for_its_project_and_a_projectless_one_for_all() {
        let pages = UiPages::default();
        let (a, b) = (PathBuf::from("/a"), PathBuf::from("/b"));
        let key_a = Some(a.clone());
        pages.add(&key_a);
        pages.add(&key_a);
        assert!(pages.is_open(&a));
        assert!(!pages.is_open(&b));
        pages.remove(&key_a);
        assert!(pages.is_open(&a));
        pages.remove(&key_a);
        assert!(!pages.is_open(&a));
        pages.add(&None);
        assert!(pages.is_open(&b));
    }
}
