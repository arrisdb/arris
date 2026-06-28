//! Object-definition retrieval for BigQuery.
//!
//! Every base table, view, materialized view and external table in a dataset
//! exposes its `CREATE …` statement through the `ddl` column of that dataset's
//! `INFORMATION_SCHEMA.TABLES` view, so "Show Definition" is a single query —
//! no reconstruction. (Routines would use `INFORMATION_SCHEMA.ROUTINES`, but the
//! schema browser never surfaces them.)

use gcp_bigquery_client::Client;

use crate::drivers::errors::Result;
use crate::{DriverError, ObjectRef, SchemaNodeKind};

/// Whether `INFORMATION_SCHEMA.TABLES.ddl` carries this kind's definition.
fn has_table_ddl(kind: SchemaNodeKind) -> bool {
    matches!(
        kind,
        SchemaNodeKind::Table
            | SchemaNodeKind::View
            | SchemaNodeKind::MaterializedView
            | SchemaNodeKind::ForeignTable
    )
}

/// Build the `SELECT ddl FROM …INFORMATION_SCHEMA.TABLES` query for `object`.
/// `project` is the connected project, used when the ref omits its database.
fn ddl_sql(project: &str, object: &ObjectRef) -> Result<String> {
    if !has_table_ddl(object.kind) {
        return Err(DriverError::Unsupported(format!(
            "BigQuery: no definition for {:?}",
            object.kind
        )));
    }
    let dataset = object
        .schema
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            DriverError::QueryFailed(format!(
                "BigQuery: cannot resolve dataset for '{}'",
                object.name
            ))
        })?;
    let proj = object
        .database
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(project);

    Ok(format!(
        "SELECT ddl FROM `{proj}.{dataset}`.INFORMATION_SCHEMA.TABLES \
         WHERE table_name = '{}'",
        object.name.replace('\'', "\\'")
    ))
}

/// `CREATE SCHEMA` for a BigQuery dataset, reconstructed from `INFORMATION_SCHEMA.SCHEMATA`.
/// `INFORMATION_SCHEMA.SCHEMATA` has no `ddl` column, so the statement is rebuilt
/// from the dataset's `catalog_name`, `schema_name` and `location` — the latter
/// carried in an `OPTIONS(location = '…')` clause, matching the `CREATE SCHEMA`
/// form a dataset is created with.
fn schema_ddl_sql(project: &str, object: &ObjectRef) -> String {
    let proj = object
        .database
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(project);
    format!(
        "SELECT 'CREATE SCHEMA `' || catalog_name || '`.`' || schema_name || '`'\n\
         || '\\nOPTIONS(location = \"' || location || '\")' AS ddl\n\
         FROM `{proj}`.INFORMATION_SCHEMA.SCHEMATA\n\
         WHERE schema_name = '{}'",
        object.name.replace('\'', "\\'")
    )
}

/// Run the DDL query for `object` and return its text with a single trailing
/// semicolon. Tables/views read the catalog's `ddl` column directly; schema
/// (dataset) DDL is reconstructed from `INFORMATION_SCHEMA.SCHEMATA`.
pub(super) async fn object_definition(
    client: &Client,
    project: &str,
    object: &ObjectRef,
    location: Option<&str>,
) -> Result<String> {
    let sql = match object.kind {
        SchemaNodeKind::Schema => schema_ddl_sql(project, object),
        _ => ddl_sql(project, object)?,
    };
    let resp = client
        .job()
        .query(project, super::driver::build_query_request(&sql, location))
        .await
        .map_err(|e| DriverError::QueryFailed(format!("{e}")))?;

    let ddl = resp
        .rows
        .as_deref()
        .unwrap_or_default()
        .iter()
        .find_map(|row| {
            row.columns
                .as_ref()?
                .first()?
                .value
                .as_ref()?
                .as_str()
                .map(|s| s.to_owned())
        })
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            DriverError::QueryFailed(format!(
                "BigQuery: definition for '{}' not found",
                object.name
            ))
        })?;
    Ok(format!("{};", ddl.trim_end().trim_end_matches(';')))
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
    fn has_table_ddl_covers_browseable_kinds() {
        assert!(has_table_ddl(SchemaNodeKind::Table));
        assert!(has_table_ddl(SchemaNodeKind::View));
        assert!(has_table_ddl(SchemaNodeKind::MaterializedView));
        assert!(has_table_ddl(SchemaNodeKind::ForeignTable));
        assert!(!has_table_ddl(SchemaNodeKind::Function));
    }

    #[test]
    fn builds_dataset_qualified_ddl_query() {
        let q = ddl_sql("conn-proj", &obj(SchemaNodeKind::Table, Some("my-proj"), Some("ds1"), "users")).unwrap();
        assert_eq!(
            q,
            "SELECT ddl FROM `my-proj.ds1`.INFORMATION_SCHEMA.TABLES WHERE table_name = 'users'"
        );
    }

    #[test]
    fn falls_back_to_connected_project_when_ref_omits_database() {
        let q = ddl_sql("conn-proj", &obj(SchemaNodeKind::View, None, Some("ds1"), "v")).unwrap();
        assert_eq!(
            q,
            "SELECT ddl FROM `conn-proj.ds1`.INFORMATION_SCHEMA.TABLES WHERE table_name = 'v'"
        );
    }

    #[test]
    fn escapes_single_quotes_in_name() {
        let q = ddl_sql("p", &obj(SchemaNodeKind::Table, None, Some("ds"), "it's")).unwrap();
        assert!(q.ends_with("WHERE table_name = 'it\\'s'"), "{q}");
    }

    #[test]
    fn missing_dataset_is_query_failed() {
        let err = ddl_sql("p", &obj(SchemaNodeKind::Table, None, None, "t")).unwrap_err();
        assert!(matches!(err, DriverError::QueryFailed(_)));
    }

    #[test]
    fn unsupported_kind_is_unsupported() {
        let err = ddl_sql("p", &obj(SchemaNodeKind::Function, None, Some("ds"), "f")).unwrap_err();
        assert!(matches!(err, DriverError::Unsupported(_)));
    }

    #[test]
    fn schema_ddl_reconstructs_create_schema_with_location_option() {
        // A schema (dataset) node carries its project in `database` and its own
        // name in `name`; the dataset has no `schema` qualifier.
        let q = schema_ddl_sql("conn-proj", &obj(SchemaNodeKind::Schema, Some("my-proj"), None, "analytics"));
        assert!(
            q.contains("FROM `my-proj`.INFORMATION_SCHEMA.SCHEMATA"),
            "{q}"
        );
        assert!(q.contains("WHERE schema_name = 'analytics'"), "{q}");
        assert!(q.contains("'CREATE SCHEMA `' || catalog_name"), "{q}");
        assert!(q.contains("OPTIONS(location = "), "{q}");
    }

    #[test]
    fn schema_ddl_falls_back_to_connected_project() {
        let q = schema_ddl_sql("conn-proj", &obj(SchemaNodeKind::Schema, None, None, "ds1"));
        assert!(q.contains("FROM `conn-proj`.INFORMATION_SCHEMA.SCHEMATA"), "{q}");
    }
}
