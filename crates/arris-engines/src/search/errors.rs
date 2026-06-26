#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("lock poisoned: {0}")]
    Lock(String),
    #[error("no file index open")]
    NoIndexOpen,
}
