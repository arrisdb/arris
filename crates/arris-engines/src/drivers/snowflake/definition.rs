//! Object-definition retrieval for Snowflake.
//!
//! Primary path: `GET_DDL(<domain>, <qualified name>, true)` returns a faithful
//! `CREATE …` statement. But `GET_DDL` is **not supported on imported (shared)
//! databases** — notably `SNOWFLAKE_SAMPLE_DATA` — where it raises "operation is
//! not supported on shared database …". For those, we fall back to reconstructing
//! the definition from the database's `INFORMATION_SCHEMA` (columns for tables /
//! external tables, `view_definition` for views / materialized views), which
//! shared databases *do* expose.

use crate::drivers::errors::Result;
use crate::{DriverError, ObjectRef, SchemaNodeKind};

use super::api::SnowflakeApi;

/// One reconstructed table column for `build_create_table`.
struct Column {
    name: String,
    type_sql: String,
    not_null: bool,
}

/// Double-quote a Snowflake identifier, doubling any embedded double quotes so
/// the catalog's stored (case-sensitive) name is matched exactly.
fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

/// `"DB"."SCHEMA"."NAME"` (database / schema omitted when absent).
fn qualified_name(object: &ObjectRef) -> String {
    let mut out = String::new();
    if let Some(db) = object.database.as_deref().filter(|s| !s.is_empty()) {
        out.push_str(&quote_ident(db));
        out.push('.');
    }
    if let Some(schema) = object.schema.as_deref().filter(|s| !s.is_empty()) {
        out.push_str(&quote_ident(schema));
        out.push('.');
    }
    out.push_str(&quote_ident(&object.name));
    out
}

/// The `<db>.INFORMATION_SCHEMA` prefix — `INFORMATION_SCHEMA` is per-database in
/// Snowflake, so it must be qualified by the object's database to reach a shared
/// database's catalog.
fn information_schema_prefix(object: &ObjectRef) -> String {
    match object.database.as_deref().filter(|s| !s.is_empty()) {
        Some(db) => format!("{}.INFORMATION_SCHEMA", quote_ident(db)),
        None => "INFORMATION_SCHEMA".to_owned(),
    }
}

/// The `GET_DDL` domain for a browseable Snowflake object kind. External tables
/// reuse the `TABLE` domain; materialized views reuse `VIEW`.
fn ddl_domain(kind: SchemaNodeKind) -> Option<&'static str> {
    match kind {
        SchemaNodeKind::Table | SchemaNodeKind::ForeignTable => Some("TABLE"),
        SchemaNodeKind::View | SchemaNodeKind::MaterializedView => Some("VIEW"),
        SchemaNodeKind::Schema => Some("SCHEMA"),
        _ => None,
    }
}

/// Build the `SELECT GET_DDL(...)` statement that returns `object`'s DDL.
/// Returns `Unsupported` for kinds Snowflake's browser never yields.
fn get_ddl_sql(object: &ObjectRef) -> Result<String> {
    let domain = ddl_domain(object.kind).ok_or_else(|| {
        DriverError::Unsupported(format!("Snowflake: no definition for {:?}", object.kind))
    })?;
    Ok(format!(
        "SELECT GET_DDL('{domain}', '{}', true)",
        qualified_name(object).replace('\'', "''")
    ))
}

/// Render a Snowflake `INFORMATION_SCHEMA.COLUMNS` row's type, folding length /
/// precision / scale back into the type so `TEXT`→`VARCHAR(n)`, `NUMBER`→`NUMBER(p,s)`.
fn render_type(
    data_type: &str,
    char_len: Option<&str>,
    precision: Option<&str>,
    scale: Option<&str>,
) -> String {
    match data_type {
        "TEXT" => char_len
            .map(|l| format!("VARCHAR({l})"))
            .unwrap_or_else(|| "VARCHAR".to_owned()),
        "NUMBER" | "DECIMAL" | "NUMERIC" => match (precision, scale) {
            (Some(p), Some(s)) => format!("NUMBER({p},{s})"),
            (Some(p), None) => format!("NUMBER({p})"),
            _ => "NUMBER".to_owned(),
        },
        other => other.to_owned(),
    }
}

/// Assemble a `CREATE TABLE` statement from reconstructed columns.
fn build_create_table(object: &ObjectRef, columns: &[Column]) -> String {
    let lines: Vec<String> = columns
        .iter()
        .map(|c| {
            let null = if c.not_null { " NOT NULL" } else { "" };
            format!("  {} {}{null}", quote_ident(&c.name), c.type_sql)
        })
        .collect();
    format!(
        "CREATE TABLE {} (\n{}\n);",
        qualified_name(object),
        lines.join(",\n")
    )
}

/// Last-resort view rendering when the body is hidden (secure views shared via a
/// database share — e.g. `SNOWFLAKE.ACCOUNT_USAGE.*` — expose columns but never
/// their `view_definition` to consumers). Show the column signature with a note
/// so the tab is still useful rather than empty.
fn build_view_signature(object: &ObjectRef, columns: &[Column]) -> String {
    let keyword = if object.kind == SchemaNodeKind::MaterializedView {
        "CREATE MATERIALIZED VIEW"
    } else {
        "CREATE VIEW"
    };
    let lines: Vec<String> = columns
        .iter()
        .map(|c| format!("  {} {}", quote_ident(&c.name), c.type_sql))
        .collect();
    format!(
        "-- View body is not exposed (secure view shared from another account).\n\
         -- Showing the column signature only.\n\
         {keyword} {} (\n{}\n);",
        qualified_name(object),
        lines.join(",\n")
    )
}

/// Read the first column of every result row as an owned string (NULLs skipped).
fn first_col_values(rows: &[Vec<Option<String>>]) -> Vec<String> {
    rows.iter()
        .filter_map(|r| r.first().and_then(|c| c.clone()))
        .collect()
}

/// Fetch a table / view's columns from `INFORMATION_SCHEMA.COLUMNS`. Shared by
/// the table reconstruction and the view column-signature fallback.
async fn fetch_columns(api: &SnowflakeApi, object: &ObjectRef) -> Result<Vec<Column>> {
    let schema = object.schema.as_deref().unwrap_or("PUBLIC").replace('\'', "''");
    let name = object.name.replace('\'', "''");
    let sql = format!(
        "SELECT column_name, data_type, character_maximum_length, \
                numeric_precision, numeric_scale, is_nullable \
         FROM {}.COLUMNS \
         WHERE table_schema = '{schema}' AND table_name = '{name}' \
         ORDER BY ordinal_position",
        information_schema_prefix(object)
    );
    let resp = api.query(&sql).await?;
    Ok(resp
        .rows
        .iter()
        .filter_map(|r| {
            let name = r.first()?.clone()?;
            let data_type = r.get(1)?.clone()?;
            let type_sql = render_type(
                &data_type,
                r.get(2).and_then(|c| c.as_deref()),
                r.get(3).and_then(|c| c.as_deref()),
                r.get(4).and_then(|c| c.as_deref()),
            );
            let not_null = r.get(5).and_then(|c| c.as_deref()) == Some("NO");
            Some(Column { name, type_sql, not_null })
        })
        .collect())
}

/// Reconstruct a table / external table from `INFORMATION_SCHEMA.COLUMNS`.
async fn reconstruct_table(api: &SnowflakeApi, object: &ObjectRef) -> Result<String> {
    let columns = fetch_columns(api, object).await?;
    if columns.is_empty() {
        return Err(DriverError::QueryFailed(format!(
            "Snowflake: definition for '{}' not found",
            object.name
        )));
    }
    Ok(build_create_table(object, &columns))
}

/// First non-empty `view_definition` for `object` from a `<prefix>.VIEWS`-shaped
/// query (both `INFORMATION_SCHEMA.VIEWS` and `ACCOUNT_USAGE.VIEWS` share the
/// `view_definition` column), or `None` when hidden / absent.
async fn view_body_from(api: &SnowflakeApi, sql: &str) -> Result<Option<String>> {
    let resp = api.query(sql).await?;
    Ok(first_col_values(&resp.rows)
        .into_iter()
        .find(|s| !s.trim().is_empty()))
}

/// SQL to read `object`'s body from its database `INFORMATION_SCHEMA.VIEWS`
/// (visible only to the view's owner / an admin).
fn information_schema_view_sql(object: &ObjectRef) -> String {
    let schema = object.schema.as_deref().unwrap_or("PUBLIC").replace('\'', "''");
    let name = object.name.replace('\'', "''");
    format!(
        "SELECT view_definition FROM {}.VIEWS \
         WHERE table_schema = '{schema}' AND table_name = '{name}'",
        information_schema_prefix(object)
    )
}

/// SQL to read `object`'s body from the account-wide `SNOWFLAKE.ACCOUNT_USAGE.VIEWS`
/// share, which exposes definitions for views across the account's own databases
/// (latency aside) where `INFORMATION_SCHEMA` is permission-gated.
fn account_usage_view_sql(object: &ObjectRef) -> String {
    let catalog = object.database.as_deref().unwrap_or("").replace('\'', "''");
    let schema = object.schema.as_deref().unwrap_or("PUBLIC").replace('\'', "''");
    let name = object.name.replace('\'', "''");
    format!(
        "SELECT view_definition FROM SNOWFLAKE.ACCOUNT_USAGE.VIEWS \
         WHERE table_catalog = '{catalog}' AND table_schema = '{schema}' \
           AND table_name = '{name}' AND deleted IS NULL"
    )
}

/// Wrap a retrieved view body into a `CREATE … VIEW …` statement (the catalog
/// stores either a full `CREATE` or a bare `SELECT` body).
fn wrap_view_body(object: &ObjectRef, body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.to_ascii_uppercase().starts_with("CREATE") {
        return format!("{};", trimmed.trim_end_matches(';'));
    }
    let keyword = if object.kind == SchemaNodeKind::MaterializedView {
        "CREATE MATERIALIZED VIEW"
    } else {
        "CREATE VIEW"
    };
    format!(
        "{keyword} {} AS\n{};",
        qualified_name(object),
        trimmed.trim_end_matches(';')
    )
}

/// Reconstruct a view / materialized view. Tries the database `INFORMATION_SCHEMA`,
/// then the account-wide `ACCOUNT_USAGE` share; if the body is hidden everywhere
/// (a secure view shared from another account), falls back to the column
/// signature so the tab still shows something useful.
async fn reconstruct_view(api: &SnowflakeApi, object: &ObjectRef) -> Result<String> {
    if let Some(body) = view_body_from(api, &information_schema_view_sql(object)).await? {
        return Ok(wrap_view_body(object, &body));
    }
    // ACCOUNT_USAGE may not exist / be granted; treat its failure as "no body".
    let account_usage = match object.database.as_deref().filter(|s| !s.is_empty()) {
        Some(_) => view_body_from(api, &account_usage_view_sql(object))
            .await
            .unwrap_or(None),
        None => None,
    };
    if let Some(body) = account_usage {
        return Ok(wrap_view_body(object, &body));
    }
    let columns = fetch_columns(api, object).await?;
    if columns.is_empty() {
        return Err(DriverError::QueryFailed(format!(
            "Snowflake: definition for '{}' not found",
            object.name
        )));
    }
    Ok(build_view_signature(object, &columns))
}

/// SQL to read a schema's name + comment from its database `INFORMATION_SCHEMA.SCHEMATA`.
fn schemata_sql(object: &ObjectRef) -> String {
    let name = object.name.replace('\'', "''");
    format!(
        "SELECT schema_name, comment FROM {}.SCHEMATA WHERE schema_name = '{name}'",
        information_schema_prefix(object)
    )
}

/// Reconstruct a `CREATE SCHEMA` (plus its `COMMENT`) from the database's
/// `INFORMATION_SCHEMA.SCHEMATA`. `GET_DDL('SCHEMA', …)` is unsupported on shared
/// databases (e.g. `SNOWFLAKE_SAMPLE_DATA`), but `SCHEMATA` is exposed there, so
/// this yields a minimal but valid definition where the native path can't.
async fn reconstruct_schema(api: &SnowflakeApi, object: &ObjectRef) -> Result<String> {
    let resp = api.query(&schemata_sql(object)).await?;
    let row = resp.rows.first().ok_or_else(|| {
        DriverError::QueryFailed(format!(
            "Snowflake: definition for '{}' not found",
            object.name
        ))
    })?;

    let mut out = format!("CREATE SCHEMA {};", qualified_name(object));
    if let Some(comment) = row.get(1).and_then(|c| c.clone()).filter(|s| !s.is_empty()) {
        out.push_str(&format!(
            "\nCOMMENT ON SCHEMA {} IS '{}';",
            qualified_name(object),
            comment.replace('\'', "''")
        ));
    }
    Ok(out)
}

/// Reconstruct `object` from `INFORMATION_SCHEMA` (the `GET_DDL` fallback for
/// shared databases).
async fn reconstruct(api: &SnowflakeApi, object: &ObjectRef) -> Result<String> {
    match object.kind {
        SchemaNodeKind::Table | SchemaNodeKind::ForeignTable => {
            reconstruct_table(api, object).await
        }
        SchemaNodeKind::View | SchemaNodeKind::MaterializedView => {
            reconstruct_view(api, object).await
        }
        SchemaNodeKind::Schema => reconstruct_schema(api, object).await,
        other => Err(DriverError::Unsupported(format!(
            "Snowflake: no definition for {other:?}"
        ))),
    }
}

/// Run `GET_DDL` for `object`; on failure (e.g. an imported/shared database,
/// where `GET_DDL` is unsupported) reconstruct the DDL from `INFORMATION_SCHEMA`.
pub(super) async fn object_definition(api: &SnowflakeApi, object: &ObjectRef) -> Result<String> {
    let sql = get_ddl_sql(object)?;
    match api.query(&sql).await {
        Ok(resp) => {
            if let Some(ddl) = resp
                .rows
                .first()
                .and_then(|r| r.first())
                .and_then(|c| c.clone())
                .filter(|s| !s.trim().is_empty())
            {
                return Ok(format!("{};", ddl.trim_end().trim_end_matches(';')));
            }
            reconstruct(api, object).await
        }
        Err(_) => reconstruct(api, object).await,
    }
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
    fn domain_maps_browseable_kinds() {
        assert_eq!(ddl_domain(SchemaNodeKind::Table), Some("TABLE"));
        assert_eq!(ddl_domain(SchemaNodeKind::ForeignTable), Some("TABLE"));
        assert_eq!(ddl_domain(SchemaNodeKind::View), Some("VIEW"));
        assert_eq!(ddl_domain(SchemaNodeKind::MaterializedView), Some("VIEW"));
        assert_eq!(ddl_domain(SchemaNodeKind::Schema), Some("SCHEMA"));
        assert_eq!(ddl_domain(SchemaNodeKind::Sequence), None);
    }

    #[test]
    fn schema_node_builds_db_qualified_get_ddl() {
        // A schema node carries its database in `database` and its own name in
        // `name`; `GET_DDL('SCHEMA', '"DB"."ANALYTICS"')` reconstructs it.
        let q = get_ddl_sql(&obj(SchemaNodeKind::Schema, Some("MYDB"), None, "ANALYTICS")).unwrap();
        assert_eq!(q, "SELECT GET_DDL('SCHEMA', '\"MYDB\".\"ANALYTICS\"', true)");
    }

    #[test]
    fn schemata_sql_is_database_qualified() {
        // The shared-database fallback reads from the schema's own database
        // `INFORMATION_SCHEMA.SCHEMATA` (e.g. SNOWFLAKE_SAMPLE_DATA).
        let o = obj(SchemaNodeKind::Schema, Some("SNOWFLAKE_SAMPLE_DATA"), None, "TPCDS_SF100TCL");
        assert_eq!(
            schemata_sql(&o),
            "SELECT schema_name, comment FROM \"SNOWFLAKE_SAMPLE_DATA\".INFORMATION_SCHEMA.SCHEMATA \
             WHERE schema_name = 'TPCDS_SF100TCL'"
        );
    }

    #[test]
    fn builds_fully_qualified_get_ddl() {
        let q = get_ddl_sql(&obj(SchemaNodeKind::Table, Some("MYDB"), Some("PUBLIC"), "users")).unwrap();
        assert_eq!(
            q,
            "SELECT GET_DDL('TABLE', '\"MYDB\".\"PUBLIC\".\"users\"', true)"
        );
    }

    #[test]
    fn view_uses_view_domain_and_omits_absent_database() {
        let q = get_ddl_sql(&obj(SchemaNodeKind::View, None, Some("PUBLIC"), "v")).unwrap();
        assert_eq!(q, "SELECT GET_DDL('VIEW', '\"PUBLIC\".\"v\"', true)");
    }

    #[test]
    fn escapes_quotes_in_identifiers() {
        let q = get_ddl_sql(&obj(SchemaNodeKind::Table, None, None, "we\"ird")).unwrap();
        assert_eq!(q, "SELECT GET_DDL('TABLE', '\"we\"\"ird\"', true)");
    }

    #[test]
    fn unsupported_kind_is_unsupported() {
        let err = get_ddl_sql(&obj(SchemaNodeKind::Function, Some("d"), Some("s"), "f")).unwrap_err();
        assert!(matches!(err, DriverError::Unsupported(_)));
    }

    #[test]
    fn information_schema_is_database_qualified() {
        let o = obj(SchemaNodeKind::Table, Some("SNOWFLAKE_SAMPLE_DATA"), Some("TPCDS_SF10TCL"), "CATALOG_PAGE");
        assert_eq!(
            information_schema_prefix(&o),
            "\"SNOWFLAKE_SAMPLE_DATA\".INFORMATION_SCHEMA"
        );
    }

    #[test]
    fn render_type_folds_length_and_precision() {
        assert_eq!(render_type("TEXT", Some("255"), None, None), "VARCHAR(255)");
        assert_eq!(render_type("TEXT", None, None, None), "VARCHAR");
        assert_eq!(render_type("NUMBER", None, Some("38"), Some("0")), "NUMBER(38,0)");
        assert_eq!(render_type("NUMBER", None, Some("10"), None), "NUMBER(10)");
        assert_eq!(render_type("FLOAT", None, None, None), "FLOAT");
        assert_eq!(render_type("TIMESTAMP_NTZ", None, None, None), "TIMESTAMP_NTZ");
    }

    #[test]
    fn account_usage_view_sql_filters_on_catalog_schema_name() {
        let o = obj(SchemaNodeKind::View, Some("SNOWFLAKE"), Some("ACCOUNT_USAGE"), "ACCESS_HISTORY");
        assert_eq!(
            account_usage_view_sql(&o),
            "SELECT view_definition FROM SNOWFLAKE.ACCOUNT_USAGE.VIEWS \
             WHERE table_catalog = 'SNOWFLAKE' AND table_schema = 'ACCOUNT_USAGE' \
               AND table_name = 'ACCESS_HISTORY' AND deleted IS NULL"
        );
    }

    #[test]
    fn information_schema_view_sql_is_database_qualified() {
        let o = obj(SchemaNodeKind::View, Some("MYDB"), Some("PUBLIC"), "v_orders");
        assert_eq!(
            information_schema_view_sql(&o),
            "SELECT view_definition FROM \"MYDB\".INFORMATION_SCHEMA.VIEWS \
             WHERE table_schema = 'PUBLIC' AND table_name = 'v_orders'"
        );
    }

    #[test]
    fn wrap_view_body_passes_through_create_and_wraps_select() {
        let o = obj(SchemaNodeKind::View, Some("DB"), Some("SC"), "V");
        assert_eq!(
            wrap_view_body(&o, "create view v as select 1"),
            "create view v as select 1;"
        );
        assert_eq!(
            wrap_view_body(&o, "SELECT a, b FROM t"),
            "CREATE VIEW \"DB\".\"SC\".\"V\" AS\nSELECT a, b FROM t;"
        );
    }

    #[test]
    fn build_view_signature_shows_columns_with_a_note() {
        let o = obj(SchemaNodeKind::View, Some("SNOWFLAKE"), Some("ACCOUNT_USAGE"), "ACCESS_HISTORY");
        let cols = vec![
            Column { name: "QUERY_ID".into(), type_sql: "VARCHAR".into(), not_null: false },
            Column { name: "QUERY_START_TIME".into(), type_sql: "TIMESTAMP_LTZ".into(), not_null: false },
        ];
        let ddl = build_view_signature(&o, &cols);
        assert_eq!(
            ddl,
            "-- View body is not exposed (secure view shared from another account).\n\
             -- Showing the column signature only.\n\
             CREATE VIEW \"SNOWFLAKE\".\"ACCOUNT_USAGE\".\"ACCESS_HISTORY\" (\n  \
             \"QUERY_ID\" VARCHAR,\n  \"QUERY_START_TIME\" TIMESTAMP_LTZ\n);"
        );
    }

    #[test]
    fn build_create_table_reconstructs_columns() {
        let o = obj(SchemaNodeKind::Table, Some("DB"), Some("SC"), "T");
        let cols = vec![
            Column { name: "ID".into(), type_sql: "NUMBER(38,0)".into(), not_null: true },
            Column { name: "NAME".into(), type_sql: "VARCHAR(100)".into(), not_null: false },
        ];
        let ddl = build_create_table(&o, &cols);
        assert_eq!(
            ddl,
            "CREATE TABLE \"DB\".\"SC\".\"T\" (\n  \"ID\" NUMBER(38,0) NOT NULL,\n  \"NAME\" VARCHAR(100)\n);"
        );
    }
}
