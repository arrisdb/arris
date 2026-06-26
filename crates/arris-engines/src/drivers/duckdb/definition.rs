//! Object-definition retrieval for DuckDB.
//!
//! DuckDB's catalog functions already expose a ready-made `sql` column carrying
//! the verbatim `CREATE …` statement for tables, views, indexes and sequences,
//! so "Show Definition" is a single catalog lookup with no reconstruction.
//! Macros (`SchemaNodeKind::Function`) are the one exception — `duckdb_functions()`
//! has no `sql` column — so their `CREATE MACRO` is reassembled from the
//! `parameters` list and `macro_definition` body, server-side, inside the query.

use duckdb::Connection;

use crate::drivers::errors::Result;
use crate::{DriverError, ObjectRef, SchemaNodeKind};

use super::query::query_rows;

/// Single-quote-escape a string for embedding as a SQL literal.
fn lit(s: &str) -> String {
    s.replace('\'', "''")
}

/// Build the catalog query that yields a one-row, one-column `sql` result
/// holding the DDL for `object`. The schema defaults to `main` when unset.
fn definition_query(object: &ObjectRef) -> Result<String> {
    let s = lit(object.schema.as_deref().unwrap_or("main"));
    let n = lit(&object.name);
    let query = match object.kind {
        SchemaNodeKind::Table => format!(
            "SELECT sql FROM duckdb_tables() \
             WHERE schema_name = '{s}' AND table_name = '{n}'"
        ),
        SchemaNodeKind::View => format!(
            "SELECT sql FROM duckdb_views() \
             WHERE NOT internal AND schema_name = '{s}' AND view_name = '{n}'"
        ),
        SchemaNodeKind::Index => format!(
            "SELECT sql FROM duckdb_indexes() \
             WHERE schema_name = '{s}' AND index_name = '{n}'"
        ),
        SchemaNodeKind::Sequence => format!(
            "SELECT sql FROM duckdb_sequences() \
             WHERE schema_name = '{s}' AND sequence_name = '{n}'"
        ),
        // `duckdb_schemas()` has no `sql` column, so reassemble `CREATE SCHEMA`
        // from `schema_name`. DuckDB has no schema-level comments (`COMMENT ON
        // SCHEMA` is unimplemented), so there is nothing else to emit. The schema
        // node's own name is in `object.name`.
        SchemaNodeKind::Schema => {
            let name = lit(&object.name);
            format!(
                "SELECT 'CREATE SCHEMA ' || schema_name AS sql \
                 FROM duckdb_schemas() WHERE schema_name = '{name}' LIMIT 1"
            )
        }
        // `duckdb_functions()` has no `sql` column; reassemble the CREATE MACRO
        // from its parameter list and body. Table macros use `AS TABLE <query>`.
        SchemaNodeKind::Function => format!(
            "SELECT 'CREATE MACRO ' || function_name || '(' \
             || array_to_string(parameters, ', ') || ') AS ' \
             || CASE WHEN function_type = 'table_macro' THEN 'TABLE ' ELSE '' END \
             || macro_definition AS sql \
             FROM duckdb_functions() \
             WHERE NOT internal AND schema_name = '{s}' AND function_name = '{n}' \
             LIMIT 1"
        ),
        other => {
            return Err(DriverError::Unsupported(format!(
                "DuckDB: no definition for {other:?}"
            )));
        }
    };
    Ok(query)
}

/// Resolve `object` against the DuckDB catalog and return its DDL, with a single
/// trailing semicolon for paste-ability.
pub(super) fn object_definition(conn: &Connection, object: &ObjectRef) -> Result<String> {
    let sql = definition_query(object)?;
    let rows: Vec<Option<String>> =
        query_rows(conn, &sql, |r| r.get::<_, Option<String>>(0).unwrap_or(None))?;
    match rows.into_iter().flatten().find(|s| !s.trim().is_empty()) {
        Some(ddl) => Ok(format!("{};", ddl.trim_end().trim_end_matches(';'))),
        None => Err(DriverError::QueryFailed(format!(
            "DuckDB: definition for '{}' not found",
            object.name
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(kind: SchemaNodeKind, name: &str) -> ObjectRef {
        ObjectRef::new(kind, name)
    }

    #[test]
    fn unsupported_kind_is_unsupported() {
        let err = definition_query(&obj(SchemaNodeKind::Column, "x")).unwrap_err();
        assert!(matches!(err, DriverError::Unsupported(_)));
    }

    #[test]
    fn query_targets_the_right_catalog_per_kind() {
        assert!(definition_query(&obj(SchemaNodeKind::Table, "t"))
            .unwrap()
            .contains("duckdb_tables()"));
        assert!(definition_query(&obj(SchemaNodeKind::View, "v"))
            .unwrap()
            .contains("duckdb_views()"));
        assert!(definition_query(&obj(SchemaNodeKind::Index, "i"))
            .unwrap()
            .contains("duckdb_indexes()"));
        assert!(definition_query(&obj(SchemaNodeKind::Sequence, "s"))
            .unwrap()
            .contains("duckdb_sequences()"));
        assert!(definition_query(&obj(SchemaNodeKind::Function, "m"))
            .unwrap()
            .contains("duckdb_functions()"));
        assert!(definition_query(&obj(SchemaNodeKind::Schema, "s"))
            .unwrap()
            .contains("duckdb_schemas()"));
    }

    #[test]
    fn schema_reconstructs_create_schema() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE SCHEMA reporting;").unwrap();

        let ddl = object_definition(&conn, &obj(SchemaNodeKind::Schema, "reporting")).unwrap();
        assert_eq!(ddl, "CREATE SCHEMA reporting;");

        // A non-existent schema surfaces an error, not empty DDL.
        let err = object_definition(&conn, &obj(SchemaNodeKind::Schema, "ghost")).unwrap_err();
        assert!(matches!(err, DriverError::QueryFailed(_)));
    }

    #[test]
    fn escapes_single_quotes_in_identifiers() {
        let q = definition_query(&obj(SchemaNodeKind::Table, "we'ird")).unwrap();
        assert!(q.contains("table_name = 'we''ird'"), "{q}");
    }

    #[test]
    fn returns_catalog_ddl_for_each_kind() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE t(id INTEGER PRIMARY KEY, name VARCHAR NOT NULL);
             CREATE VIEW v AS SELECT id FROM t;
             CREATE INDEX t_name_idx ON t(name);
             CREATE SEQUENCE s START 5 INCREMENT 2;
             CREATE MACRO m(a) AS a * 2;",
        )
        .unwrap();

        let table = object_definition(&conn, &obj(SchemaNodeKind::Table, "t")).unwrap();
        assert!(table.starts_with("CREATE TABLE t"), "{table}");
        assert!(table.ends_with(';') && !table.ends_with(";;"), "{table}");

        let view = object_definition(&conn, &obj(SchemaNodeKind::View, "v")).unwrap();
        assert!(view.starts_with("CREATE VIEW v"), "{view}");

        let index = object_definition(&conn, &obj(SchemaNodeKind::Index, "t_name_idx")).unwrap();
        assert!(index.starts_with("CREATE INDEX t_name_idx"), "{index}");

        let seq = object_definition(&conn, &obj(SchemaNodeKind::Sequence, "s")).unwrap();
        assert!(seq.starts_with("CREATE SEQUENCE s"), "{seq}");

        let macro_def = object_definition(&conn, &obj(SchemaNodeKind::Function, "m")).unwrap();
        assert!(macro_def.starts_with("CREATE MACRO m(a) AS"), "{macro_def}");
    }

    #[test]
    fn missing_object_is_query_failed() {
        let conn = Connection::open_in_memory().unwrap();
        let err = object_definition(&conn, &obj(SchemaNodeKind::Table, "ghost")).unwrap_err();
        assert!(matches!(err, DriverError::QueryFailed(_)));
    }
}
