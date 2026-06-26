//! Object-definition retrieval for SQLite.
//!
//! SQLite stores the verbatim `CREATE …` text of every table, view, index and
//! trigger in `sqlite_master.sql`, so "Show Definition" is a single catalog
//! lookup — no reconstruction. The `sql` column is `NULL` only for objects the
//! engine created implicitly (e.g. auto-indexes), which never reach this path
//! because the schema browser filters them out.

use rusqlite::{Connection, OptionalExtension};

use crate::drivers::errors::Result;
use crate::{DriverError, ObjectRef, SchemaNodeKind};

/// The `sqlite_master.type` value backing a given object kind, or `None` for
/// kinds SQLite has no stored DDL for (columns, …).
fn master_type(kind: SchemaNodeKind) -> Option<&'static str> {
    match kind {
        SchemaNodeKind::Table => Some("table"),
        SchemaNodeKind::View => Some("view"),
        SchemaNodeKind::Index => Some("index"),
        SchemaNodeKind::Trigger => Some("trigger"),
        _ => None,
    }
}

/// Read the stored `CREATE …` statement for `object` from `sqlite_master`,
/// appending a single trailing semicolon for paste-ability.
pub(super) fn object_definition(conn: &Connection, object: &ObjectRef) -> Result<String> {
    let ty = master_type(object.kind).ok_or_else(|| {
        DriverError::Unsupported(format!("SQLite: no definition for {:?}", object.kind))
    })?;

    let mut stmt = conn
        .prepare("SELECT sql FROM sqlite_master WHERE type = ?1 AND name = ?2")
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;
    let sql: Option<Option<String>> = stmt
        .query_row((ty, object.name.as_str()), |r| {
            r.get::<_, Option<String>>(0)
        })
        .optional()
        .map_err(|e| DriverError::QueryFailed(e.to_string()))?;

    match sql.flatten() {
        Some(ddl) if !ddl.trim().is_empty() => {
            Ok(format!("{};", ddl.trim_end().trim_end_matches(';')))
        }
        _ => Err(DriverError::QueryFailed(format!(
            "SQLite: definition for '{}' not found",
            object.name
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn master_type_maps_supported_kinds() {
        assert_eq!(master_type(SchemaNodeKind::Table), Some("table"));
        assert_eq!(master_type(SchemaNodeKind::View), Some("view"));
        assert_eq!(master_type(SchemaNodeKind::Index), Some("index"));
        assert_eq!(master_type(SchemaNodeKind::Trigger), Some("trigger"));
    }

    #[test]
    fn master_type_rejects_unsupported_kinds() {
        assert_eq!(master_type(SchemaNodeKind::Column), None);
        assert_eq!(master_type(SchemaNodeKind::Sequence), None);
        assert_eq!(master_type(SchemaNodeKind::Function), None);
    }

    fn obj(kind: SchemaNodeKind, name: &str) -> ObjectRef {
        ObjectRef::new(kind, name)
    }

    #[test]
    fn returns_stored_ddl_with_single_trailing_semicolon() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
             CREATE VIEW active AS SELECT id FROM users;
             CREATE INDEX users_name_idx ON users(name);
             CREATE TRIGGER users_ai AFTER INSERT ON users BEGIN SELECT NEW.id; END;",
        )
        .unwrap();

        let table = object_definition(&conn, &obj(SchemaNodeKind::Table, "users")).unwrap();
        assert!(table.starts_with("CREATE TABLE users"));
        assert!(table.ends_with(';'));
        assert!(!table.ends_with(";;"));

        let view = object_definition(&conn, &obj(SchemaNodeKind::View, "active")).unwrap();
        assert!(view.starts_with("CREATE VIEW active"));

        let index = object_definition(&conn, &obj(SchemaNodeKind::Index, "users_name_idx")).unwrap();
        assert!(index.starts_with("CREATE INDEX users_name_idx"));

        let trigger = object_definition(&conn, &obj(SchemaNodeKind::Trigger, "users_ai")).unwrap();
        assert!(trigger.starts_with("CREATE TRIGGER users_ai"));
    }

    #[test]
    fn missing_object_is_query_failed() {
        let conn = Connection::open_in_memory().unwrap();
        let err = object_definition(&conn, &obj(SchemaNodeKind::Table, "ghost")).unwrap_err();
        assert!(matches!(err, DriverError::QueryFailed(_)));
    }

    #[test]
    fn unsupported_kind_is_unsupported() {
        let conn = Connection::open_in_memory().unwrap();
        let err = object_definition(&conn, &obj(SchemaNodeKind::Column, "x")).unwrap_err();
        assert!(matches!(err, DriverError::Unsupported(_)));
    }
}
