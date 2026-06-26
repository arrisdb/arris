//! `SHOW CREATE …` DDL retrieval for MySQL / MariaDB.
//!
//! MySQL surfaces an object's definition via `SHOW CREATE {TYPE} `db`.`name``.
//! The result is a single row, but both the column COUNT and the exact column
//! NAME holding the `CREATE …` text vary by object type (e.g. `Create Table`,
//! `SQL Original Statement`). `DefinitionQuery` builds the statement and pins
//! the expected label; `extract_definition` reads it back robustly, falling
//! back to the last `Create`/`Statement` column when the label drifts across
//! server versions (notably MariaDB sequences).

use mysql_async::{Row, Value as MyValue};

use crate::drivers::errors::Result;
use crate::{DriverError, ObjectRef, SchemaNodeKind};

/// The `SHOW CREATE` statement plus the column label expected to carry the DDL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct DefinitionQuery {
    pub sql: String,
    pub label: &'static str,
}

impl DefinitionQuery {
    /// Map a supported object kind to its `SHOW CREATE {TYPE}` keyword and the
    /// column name that holds the `CREATE …` text. Unsupported kinds (indexes,
    /// materialized views, …) yield `None` so the caller can report them.
    fn kind_keyword(kind: SchemaNodeKind) -> Option<(&'static str, &'static str)> {
        match kind {
            SchemaNodeKind::Table => Some(("TABLE", "Create Table")),
            SchemaNodeKind::View => Some(("VIEW", "Create View")),
            SchemaNodeKind::Function => Some(("FUNCTION", "Create Function")),
            SchemaNodeKind::Procedure => Some(("PROCEDURE", "Create Procedure")),
            SchemaNodeKind::Trigger => Some(("TRIGGER", "SQL Original Statement")),
            SchemaNodeKind::Event => Some(("EVENT", "Create Event")),
            // MariaDB sequences: `SHOW CREATE SEQUENCE` labels the DDL column
            // `Create Table`. `extract_definition` falls back if absent.
            SchemaNodeKind::Sequence => Some(("SEQUENCE", "Create Table")),
            _ => None,
        }
    }

    /// Build the `SHOW CREATE` query for `object`, resolving the database as
    /// `schema` else `database`. Identifiers are backtick-quoted with embedded
    /// backticks doubled. Returns `Unsupported` for kinds without DDL retrieval
    /// and `QueryFailed` when no database can be resolved.
    pub(super) fn for_object(object: &ObjectRef) -> Result<Self> {
        // A database node IS the schema in MySQL/MariaDB. `SHOW CREATE DATABASE`
        // takes a single, unqualified identifier (the database's own name), so
        // it can't go through the `db.name` keyword path below.
        if object.kind == SchemaNodeKind::Database {
            return Ok(Self {
                sql: format!("SHOW CREATE DATABASE {}", quote_ident(&object.name)),
                label: "Create Database",
            });
        }

        let (keyword, label) = Self::kind_keyword(object.kind).ok_or_else(|| {
            DriverError::Unsupported(format!("MySQL: no definition for {:?}", object.kind))
        })?;

        let db = object
            .schema
            .as_deref()
            .or(object.database.as_deref())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                DriverError::QueryFailed(format!(
                    "MySQL: cannot resolve database for object {:?}",
                    object.name
                ))
            })?;

        let sql = format!(
            "SHOW CREATE {keyword} {}.{}",
            quote_ident(db),
            quote_ident(&object.name)
        );
        Ok(Self { sql, label })
    }
}

/// Backtick-quote a MySQL identifier, doubling any embedded backticks.
fn quote_ident(ident: &str) -> String {
    format!("`{}`", ident.replace('`', "``"))
}

/// Read a `Value` as a UTF-8 `String`, decoding `Bytes` lossily and treating
/// `NULL` / non-textual values as absent.
fn value_to_string(value: &MyValue) -> Option<String> {
    match value {
        MyValue::Bytes(bs) => Some(String::from_utf8_lossy(bs).into_owned()),
        MyValue::NULL => None,
        other => Some(format!("{other:?}")),
    }
}

/// Pull the DDL text out of the single `SHOW CREATE` result row.
///
/// Primary match: the column whose name equals `label` (case-insensitive).
/// Fallback: the LAST column whose name contains `Create` or `Statement`
/// (case-insensitive) — covers server-version label drift (e.g. MariaDB
/// sequences). Returns `QueryFailed` when no row or no usable column is found.
pub(super) fn definition_from_row(row: &Row, label: &str) -> Result<String> {
    let columns = row.columns_ref();
    let names: Vec<String> = columns
        .iter()
        .map(|c| c.name_str().into_owned())
        .collect();

    let primary = names.iter().position(|n| n.eq_ignore_ascii_case(label));

    let idx = primary.or_else(|| {
        names.iter().enumerate().rev().find_map(|(i, n)| {
            let lower = n.to_ascii_lowercase();
            if lower.contains("create") || lower.contains("statement") {
                Some(i)
            } else {
                None
            }
        })
    });

    let idx = idx.ok_or_else(|| {
        DriverError::QueryFailed(format!(
            "MySQL: SHOW CREATE returned no `{label}` column (found: {names:?})"
        ))
    })?;

    row.as_ref(idx)
        .and_then(value_to_string)
        .ok_or_else(|| DriverError::QueryFailed("MySQL: empty definition column".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(kind: SchemaNodeKind, db: Option<&str>, schema: Option<&str>, name: &str) -> ObjectRef {
        ObjectRef {
            kind,
            database: db.map(Into::into),
            schema: schema.map(Into::into),
            name: name.into(),
        }
    }

    #[test]
    fn builds_show_create_table_with_schema() {
        let q = DefinitionQuery::for_object(&obj(
            SchemaNodeKind::Table,
            None,
            Some("appdb"),
            "users",
        ))
        .unwrap();
        assert_eq!(q.sql, "SHOW CREATE TABLE `appdb`.`users`");
        assert_eq!(q.label, "Create Table");
    }

    #[test]
    fn schema_takes_precedence_over_database() {
        let q = DefinitionQuery::for_object(&obj(
            SchemaNodeKind::View,
            Some("dbfield"),
            Some("schemafield"),
            "v",
        ))
        .unwrap();
        assert_eq!(q.sql, "SHOW CREATE VIEW `schemafield`.`v`");
        assert_eq!(q.label, "Create View");
    }

    #[test]
    fn falls_back_to_database_when_no_schema() {
        let q = DefinitionQuery::for_object(&obj(
            SchemaNodeKind::Function,
            Some("appdb"),
            None,
            "normalize",
        ))
        .unwrap();
        assert_eq!(q.sql, "SHOW CREATE FUNCTION `appdb`.`normalize`");
        assert_eq!(q.label, "Create Function");
    }

    #[test]
    fn builds_show_create_database_for_database_node() {
        let q = DefinitionQuery::for_object(&obj(
            SchemaNodeKind::Database,
            Some("appdb"),
            None,
            "appdb",
        ))
        .unwrap();
        assert_eq!(q.sql, "SHOW CREATE DATABASE `appdb`");
        assert_eq!(q.label, "Create Database");
    }

    #[test]
    fn database_node_uses_its_own_name_not_qualifier() {
        // The frontend fills `database` with the same name; only `object.name`
        // drives the unqualified `SHOW CREATE DATABASE`.
        let q = DefinitionQuery::for_object(&obj(
            SchemaNodeKind::Database,
            Some("ignored"),
            Some("ignored"),
            "we`ird",
        ))
        .unwrap();
        assert_eq!(q.sql, "SHOW CREATE DATABASE `we``ird`");
    }

    #[test]
    fn escapes_backticks_in_db_and_name() {
        let q = DefinitionQuery::for_object(&obj(
            SchemaNodeKind::Table,
            None,
            Some("we`ird"),
            "ta`ble",
        ))
        .unwrap();
        assert_eq!(q.sql, "SHOW CREATE TABLE `we``ird`.`ta``ble`");
    }

    #[test]
    fn keyword_and_label_mapping_per_kind() {
        let cases = [
            (SchemaNodeKind::Table, "TABLE", "Create Table"),
            (SchemaNodeKind::View, "VIEW", "Create View"),
            (SchemaNodeKind::Function, "FUNCTION", "Create Function"),
            (SchemaNodeKind::Procedure, "PROCEDURE", "Create Procedure"),
            (SchemaNodeKind::Trigger, "TRIGGER", "SQL Original Statement"),
            (SchemaNodeKind::Event, "EVENT", "Create Event"),
            (SchemaNodeKind::Sequence, "SEQUENCE", "Create Table"),
        ];
        for (kind, keyword, label) in cases {
            let (kw, lbl) = DefinitionQuery::kind_keyword(kind).unwrap();
            assert_eq!(kw, keyword, "keyword for {kind:?}");
            assert_eq!(lbl, label, "label for {kind:?}");
        }
    }

    #[test]
    fn unsupported_kinds_report_unsupported() {
        for kind in [
            SchemaNodeKind::Index,
            SchemaNodeKind::MaterializedView,
            SchemaNodeKind::Column,
            SchemaNodeKind::Type,
        ] {
            assert!(DefinitionQuery::kind_keyword(kind).is_none());
            let err = DefinitionQuery::for_object(&obj(kind, Some("d"), None, "x")).unwrap_err();
            assert!(matches!(err, DriverError::Unsupported(_)), "{kind:?}");
        }
    }

    #[test]
    fn empty_database_resolves_to_query_failed() {
        let err = DefinitionQuery::for_object(&obj(SchemaNodeKind::Table, None, None, "users"))
            .unwrap_err();
        assert!(matches!(err, DriverError::QueryFailed(_)));

        let err =
            DefinitionQuery::for_object(&obj(SchemaNodeKind::Table, Some(""), Some(""), "users"))
                .unwrap_err();
        assert!(matches!(err, DriverError::QueryFailed(_)));
    }

    #[test]
    fn value_to_string_decodes_bytes_and_skips_null() {
        assert_eq!(
            value_to_string(&MyValue::Bytes(b"CREATE TABLE t".to_vec())),
            Some("CREATE TABLE t".to_string())
        );
        assert_eq!(value_to_string(&MyValue::NULL), None);
    }
}
